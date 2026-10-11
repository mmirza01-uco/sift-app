import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/store.js";
import { AiError } from "../src/jev.js";

const HIGH = {
  kategori: { choice: "penipuan_berhadiah", confidence: 0.93 },
  risiko: { score: 1.85, confidence: 0.86 },
  mendesak: { noul: 0.9 },
};

// Jev dan Gemini palsu yang mencatat jumlah panggilan
const calls = { jev: 0, gemini: 0, lastJevText: "" };
let jevMode = "ok";
let geminiMode = "ok";
const jev = {
  model: "test/jev",
  async assess(text) {
    calls.jev++; calls.lastJevText = text;
    if (jevMode === "fail") throw new AiError("down");
    return { answers: HIGH, model: "test/jev@1", costUsd: 0.00001 };
  },
};
const gemini = {
  model: "test/gemini",
  async writeReply({ tone }) {
    calls.gemini++;
    if (geminiMode === "fail") return { reply: `template-${tone}`, reason: "", fallback: true };
    return { reply: `balasan-${tone}`, reason: "alasan uji", fallback: false };
  },
};
const verifyToken = async (t) => {
  if (t === "alice" || t === "bob" || t === "carol") return { uid: t, name: t, email: "" };
  throw new Error("bad");
};

let server, base;
before(async () => {
  const app = createApp({ store: createMemoryStore(), jev, gemini, verifyToken, config: { dailyQuota: 3, publicConfig: { demoMode: true } } });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (path, { token = "alice", method = "GET", body } = {}) =>
  fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const MSG = "Selamat! Nomor Anda menang hadiah. Hubungi 081234567890 dan klik bit.ly/abc sebelum jam 12.";

test("health tanpa auth", async () => {
  const r = await call("/api/health", { token: null });
  assert.equal(r.status, 200);
});

test("analyze tanpa token = 401", async () => {
  const r = await call("/api/analyze", { token: null, method: "POST", body: { message: MSG } });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.code, "unauthenticated");
});

test("analyze pesan 10 karakter = 400, nada tak dikenal = 400", async () => {
  let r = await call("/api/analyze", { method: "POST", body: { message: "pendek aja" } });
  assert.equal(r.status, 400);
  r = await call("/api/analyze", { method: "POST", body: { message: MSG, tone: "galak" } });
  assert.equal(r.status, 400);
});

let firstId;
test("analyze pesan baru: Jev + Gemini dipanggil, data pribadi disamarkan", async () => {
  const r = await call("/api/analyze", { method: "POST", body: { message: MSG, tone: "hormat" } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.category, "penipuan_berhadiah");
  assert.equal(d.riskLevel, "tinggi");
  assert.equal(d.urgent, true);
  assert.equal(d.reply, "balasan-hormat");
  assert.equal(d.fromCache, false);
  assert.equal(calls.jev, 1);
  assert.equal(calls.gemini, 1);
  assert.ok(!calls.lastJevText.includes("081234567890"));
  firstId = d.analysisId;
});

test("pesan identik (beda spasi/huruf) diambil dari cache tanpa Jev dan Gemini", async () => {
  const r = await call("/api/analyze", { token: "bob", method: "POST", body: { message: `  ${MSG.toUpperCase()}   `, tone: "hormat" } });
  const d = await r.json();
  assert.equal(d.fromCache, true);
  assert.equal(d.reply, "balasan-hormat");
  assert.equal(calls.jev, 1);
  assert.equal(calls.gemini, 1);
});

test("reply nada lain memanggil Gemini sekali lalu tersimpan di cache", async () => {
  let r = await call("/api/reply", { method: "POST", body: { analysisId: firstId, tone: "santai" } });
  assert.equal((await r.json()).reply, "balasan-santai");
  assert.equal(calls.gemini, 2);
  r = await call("/api/reply", { method: "POST", body: { analysisId: firstId, tone: "santai" } });
  assert.equal(r.status, 200);
  assert.equal(calls.gemini, 2);
});

test("reply untuk analisis milik pengguna lain = 404", async () => {
  const r = await call("/api/reply", { token: "bob", method: "POST", body: { analysisId: firstId, tone: "netral" } });
  assert.equal(r.status, 404);
});

test("riwayat hanya milik pengguna, bisa dihapus", async () => {
  let r = await call("/api/history");
  let d = await r.json();
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].id, firstId);
  r = await call(`/api/history/${firstId}`, { method: "DELETE" });
  assert.equal(r.status, 204);
  d = await (await call("/api/history")).json();
  assert.equal(d.items.length, 0);
});

test("Gemini gagal: tetap 200 dengan balasan template", async () => {
  geminiMode = "fail";
  const r = await call("/api/analyze", { token: "carol", method: "POST", body: { message: "Pesan baru tentang hadiah undian, klik link sekarang juga ya", tone: "netral" } });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.reply, "template-netral");
  geminiMode = "ok";
});

test("Jev gagal = 502 ai_unavailable", async () => {
  jevMode = "fail";
  const r = await call("/api/analyze", { token: "carol", method: "POST", body: { message: "Pesan lain yang benar-benar baru untuk menguji kegagalan Jev" } });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error.code, "ai_unavailable");
  jevMode = "ok";
});

test("kuota: analisis baru ke-4 (kuota 3) = 429, cache tetap boleh", async () => {
  // alice sudah memakai 1 kuota
  for (const n of [1, 2]) {
    const r = await call("/api/analyze", { method: "POST", body: { message: `Pesan kuota nomor ${n} yang cukup panjang untuk diuji` } });
    assert.equal(r.status, 200);
  }
  let r = await call("/api/analyze", { method: "POST", body: { message: "Pesan kuota nomor 3 yang cukup panjang untuk diuji" } });
  assert.equal(r.status, 429);
  r = await call("/api/analyze", { method: "POST", body: { message: MSG } });
  assert.equal(r.status, 200);
});

test("feedback label tak dikenal = 400, valid = 204", async () => {
  let r = await call("/api/feedback", { method: "POST", body: { analysisId: "x", label: "aneh" } });
  assert.equal(r.status, 400);
  r = await call("/api/feedback", { method: "POST", body: { analysisId: "x", label: "salah_kategori" } });
  assert.equal(r.status, 204);
});

test("JSON rusak = 400, endpoint tak dikenal = 404, frontend tersaji", async () => {
  let r = await fetch(`${base}/api/analyze`, { method: "POST", headers: { Authorization: "Bearer alice", "Content-Type": "application/json" }, body: "{rusak" });
  assert.equal(r.status, 400);
  r = await call("/api/tidak-ada");
  assert.equal(r.status, 404);
  r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Sift/);
});
