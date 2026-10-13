// Evaluasi Jev terhadap dataset berlabel: `npm run eval`
// Membutuhkan OPENROUTER_API_KEY di .env. Hasil lengkap disimpan ke test/eval-results.json.
import { readFile, writeFile } from "node:fs/promises";
import { createJevClient } from "../src/jev.js";
import { decide, CATEGORIES } from "../src/decision.js";
import { redact } from "../src/normalize.js";

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows;
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("Isi OPENROUTER_API_KEY di file .env dulu."); process.exit(1); }
const jev = createJevClient({ apiKey: key, model: process.env.JEV_MODEL || "typesafe/jev-1.13" });
const rows = parseCsv(await readFile(new URL("../test/dataset.csv", import.meta.url), "utf8"));
console.log(`Mengevaluasi ${rows.length} pesan dengan ${jev.model}...\n`);

const results = []; let cost = 0;
for (const r of rows) {
  try {
    const out = await jev.assess(redact(r.teks));
    const d = decide(out.answers);
    cost += out.costUsd || 0;
    results.push({ id: r.id, label: r.label_kategori, labelRisk: r.label_risiko, pred: d.category, predRisk: d.riskLevel, confidence: d.confidence, lowConfidence: d.lowConfidence, raw: out.answers });
    process.stdout.write(d.category === r.label_kategori ? "." : "x");
  } catch (e) {
    results.push({ id: r.id, error: e.message });
    process.stdout.write("!");
  }
}
const failed = results.filter((r) => r.error);
if (failed.length) console.log(`\n\n${failed.length} panggilan gagal. Contoh error: ${failed[0].error}`);
const ok = results.filter((r) => !r.error);
const correct = ok.filter((r) => r.pred === r.label);
const wrong = ok.filter((r) => r.pred !== r.label);
console.log(`\n\nAkurasi kategori: ${correct.length}/${ok.length} (${((correct.length / Math.max(ok.length, 1)) * 100).toFixed(1)}%)`);
console.log(`Akurasi risiko:   ${ok.filter((r) => r.predRisk === r.labelRisk).length}/${ok.length}`);

console.log("\nConfusion matrix (baris = label, kolom = prediksi):");
console.log("".padEnd(20) + CATEGORIES.map((c) => c.slice(0, 10).padEnd(12)).join(""));
for (const l of CATEGORIES) {
  console.log(l.padEnd(20) + CATEGORIES.map((p) => String(ok.filter((r) => r.label === l && r.pred === p).length).padEnd(12)).join(""));
}
const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-");
console.log(`\nRata-rata keyakinan kategori, jawaban benar: ${avg(correct.map((r) => r.confidence.kategori))}`);
console.log(`Rata-rata keyakinan kategori, jawaban salah: ${avg(wrong.map((r) => r.confidence.kategori))}`);
console.log(`Jawaban salah yang tertangkap mode ragu: ${wrong.filter((r) => r.lowConfidence).length}/${wrong.length}`);
console.log(`Jawaban benar yang ikut ragu: ${correct.filter((r) => r.lowConfidence).length}/${correct.length} (target <= 25%)`);
console.log(`\nTotal biaya Jev: US$${cost.toFixed(6)}`);

await writeFile(new URL("../test/eval-results.json", import.meta.url), JSON.stringify({ model: jev.model, at: new Date().toISOString(), cost, results }, null, 2));
console.log("Hasil lengkap: test/eval-results.json");
