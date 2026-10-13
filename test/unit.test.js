import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, hashMessage, redact } from "../src/normalize.js";
import { decide } from "../src/decision.js";
import { buildJevRequest } from "../src/jev.js";

test("normalize: spasi, emoji, label Diteruskan, dan huruf besar menghasilkan hash sama", () => {
  const a = "Diteruskan\nSEBARKAN!!!   Minum air hangat 🙏🙏 tiap pagi";
  const b = "sebarkan! minum air hangat tiap pagi";
  assert.equal(normalize(a), b);
  assert.equal(hashMessage(a), hashMessage(b));
});

test("normalize: karakter tak terlihat dihapus", () => {
  assert.equal(hashMessage("halo​ dunia﻿"), hashMessage("halo dunia"));
});

test("normalize: URL berbeda menghasilkan hash berbeda", () => {
  assert.notEqual(hashMessage("klik bit.ly/aaa sekarang"), hashMessage("klik bit.ly/bbb sekarang"));
});

test("redact: nomor HP, email, dan 16 digit disamarkan", () => {
  const out = redact("Hubungi 0812-3456-7890 atau +6281234567890, email budi@mail.com, NIK 3201234567890123");
  assert.ok(!/0812|62812|budi@|3201234567890123/.test(out), out);
  assert.equal((out.match(/\[disamarkan\]/g) || []).length, 4);
});

const ans = (choice, ck, score, cr, noul = 0.1) => ({
  kategori: { choice, confidence: ck },
  risiko: { score, confidence: cr },
  mendesak: { noul },
});

test("decide: batas skor 0,74 rendah, 0,75 sedang, 1,5 tinggi", () => {
  assert.equal(decide(ans("hoaks_kesehatan", 0.9, 0.74, 0.9)).riskLevel, "rendah");
  assert.equal(decide(ans("hoaks_kesehatan", 0.9, 0.75, 0.9)).riskLevel, "sedang");
  assert.equal(decide(ans("hoaks_kesehatan", 0.9, 1.5, 0.9)).riskLevel, "tinggi");
});

test("decide: keyakinan kategori 0,59 memicu mode ragu", () => {
  const d = decide(ans("hoaks_kesehatan", 0.59, 1.8, 0.9));
  assert.equal(d.lowConfidence, true);
  assert.equal(d.needsReply, false);
});

test("decide: kategori aman dengan risiko tinggi dianggap ragu", () => {
  assert.equal(decide(ans("aman", 0.95, 1.9, 0.9)).lowConfidence, true);
});

test("decide: risiko tinggi dan yakin memerlukan balasan; mendesak >= 0,6", () => {
  const d = decide(ans("penipuan_berhadiah", 0.92, 1.8, 0.85, 0.6));
  assert.equal(d.needsReply, true);
  assert.equal(d.urgent, true);
});

test("decide: jawaban rusak tidak membuat crash", () => {
  const d = decide(undefined);
  assert.equal(d.category, "aman");
  assert.equal(d.lowConfidence, true);
});

test("buildJevRequest: model dikunci dan tiga pertanyaan lengkap", () => {
  const r = buildJevRequest("halo", "typesafe/jev-1.13");
  assert.equal(r.model, "typesafe/jev-1.13");
  assert.deepEqual(Object.keys(r.questions), ["kategori", "risiko", "mendesak"]);
  assert.deepEqual(r.questions.risiko.criteria, ["rendah", "sedang", "tinggi"]);
});
