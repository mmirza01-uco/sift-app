// Logika keputusan server atas jawaban Jev.
// Ambang di bawah adalah titik awal; setel ulang dengan `npm run eval`.
export const THRESHOLDS = {
  riskMid: 0.75, // skor 0..2: < 0.75 rendah, < 1.5 sedang, >= 1.5 tinggi
  riskHigh: 1.5,
  urgent: 0.6, // peluang "ya" untuk pertanyaan mendesak
  minCategoryConfidence: 0.6,
  minRiskConfidence: 0.5,
};

export const CATEGORIES = ["hoaks_kesehatan", "penipuan_berhadiah", "info_politik", "aman"];

export const CATEGORY_LABEL = {
  hoaks_kesehatan: "Hoaks kesehatan",
  penipuan_berhadiah: "Penipuan berhadiah",
  info_politik: "Info politik atau kebijakan",
  aman: "Kabar biasa",
};

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * @param {object} answers  objek `answers` dari Decisions API Jev
 * @returns {{category, riskLevel, riskScore, urgent, urgentProb, confidence, lowConfidence, needsReply}}
 */
export function decide(answers, t = THRESHOLDS) {
  const kat = answers?.kategori ?? {};
  const ris = answers?.risiko ?? {};
  const men = answers?.mendesak ?? {};

  const category = CATEGORIES.includes(kat.choice) ? kat.choice : "aman";
  const riskScore = num(ris.score);
  const riskLevel = riskScore >= t.riskHigh ? "tinggi" : riskScore >= t.riskMid ? "sedang" : "rendah";
  const urgentProb = num(men.noul);
  const confidence = { kategori: num(kat.confidence), risiko: num(ris.confidence) };

  const contradictory = category === "aman" && riskLevel === "tinggi";
  const lowConfidence =
    contradictory ||
    confidence.kategori < t.minCategoryConfidence ||
    confidence.risiko < t.minRiskConfidence;

  return {
    category,
    riskLevel,
    riskScore: Math.round(riskScore * 100) / 100,
    urgent: urgentProb >= t.urgent,
    urgentProb: Math.round(urgentProb * 100) / 100,
    confidence: {
      kategori: Math.round(confidence.kategori * 100) / 100,
      risiko: Math.round(confidence.risiko * 100) / 100,
    },
    lowConfidence,
    needsReply: !lowConfidence && riskLevel !== "rendah",
  };
}
