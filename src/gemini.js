// Klien Gemini untuk menulis balasan. Gemini tidak pernah diminta menilai risiko.
import { CATEGORY_LABEL } from "./decision.js";

export const TONES = ["hormat", "netral", "santai"];

export const SYSTEM_INSTRUCTION = `Kamu menulis balasan untuk grup WhatsApp keluarga di Indonesia.
Tujuan: mengingatkan dengan halus bahwa pesan yang diteruskan kemungkinan tidak benar atau berbahaya.
Aturan:
- Bahasa Indonesia sehari-hari yang santun, maksimal 80 kata.
- Hormati pengirim. Jangan menyalahkan, menyindir, atau menggurui.
- Jangan mengarang fakta, angka, atau nama lembaga. Bila perlu rujukan, sarankan mengecek ke situs cek fakta.
- Akhiri dengan ajakan ringan untuk tidak meneruskan dulu.
- Sesuaikan sapaan dengan nada: hormat (Bapak/Ibu/Om/Tante), netral, atau santai (ke sepupu atau teman sebaya).
Keluarkan JSON: {"balasan": string, "ringkasan_alasan": string (maks 20 kata)}`;

// Template cadangan bila Gemini gagal atau kuota tier gratis habis.
const FALLBACK = {
  hoaks_kesehatan: {
    hormat: "Maaf Om, Tante, izin mengingatkan. Info kesehatan ini belum tentu benar dan pesan serupa sering beredar sebagai hoaks. Sebaiknya ditanyakan ke dokter dulu dan tidak diteruskan sementara ya. Terima kasih sudah peduli.",
    netral: "Izin mengingatkan, klaim kesehatan di pesan ini belum tentu benar dan sering beredar sebagai hoaks. Sebaiknya dikonfirmasi ke tenaga kesehatan dulu dan tidak diteruskan sementara.",
    santai: "Eh, info kesehatan ini belum tentu bener deh, sering muncul sebagai hoaks. Tanya dokter dulu aja ya, jangan diterusin dulu.",
  },
  penipuan_berhadiah: {
    hormat: "Bapak, Ibu, mohon hati-hati dengan pesan ini. Ciri-cirinya mirip penipuan: menjanjikan hadiah, meminta data, atau meminta klik tautan. Sebaiknya tautannya tidak dibuka dan pesannya tidak diteruskan dulu ya.",
    netral: "Hati-hati, pesan ini memiliki ciri penipuan: hadiah, permintaan data, dan tautan. Sebaiknya tautan tidak dibuka dan pesan tidak diteruskan.",
    santai: "Guys, ini kayaknya penipuan deh. Jangan klik link-nya dan jangan kasih data apa pun ya. Jangan diterusin juga.",
  },
  info_politik: {
    hormat: "Maaf, izin mengingatkan. Kabar ini belum jelas sumbernya, jadi mungkin lebih baik kita cek dulu ke situs cek fakta sebelum diteruskan ya. Terima kasih.",
    netral: "Kabar ini belum jelas sumbernya. Sebaiknya dicek dulu ke situs cek fakta sebelum diteruskan.",
    santai: "Info ini sumbernya belum jelas nih. Cek dulu di situs cek fakta yuk sebelum disebar.",
  },
};
FALLBACK.aman = FALLBACK.info_politik;

export function fallbackReply(category, tone) {
  return (FALLBACK[category] ?? FALLBACK.info_politik)[tone] ?? FALLBACK.info_politik.netral;
}

export function buildUserPrompt({ tone, category, riskLevel, urgent, message }) {
  return [
    `Nada: ${tone}`,
    `Kategori: ${category} (${CATEGORY_LABEL[category] ?? category})`,
    `Tingkat risiko: ${riskLevel}`,
    `Mendesak: ${urgent ? "ya" : "tidak"}`,
    "Pesan asli:",
    message,
  ].join("\n");
}

export function createGeminiClient({ apiKey, model, timeoutMs = 15_000 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  async function once(input) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text);
    if (typeof parsed.balasan !== "string" || !parsed.balasan.trim()) throw new Error("JSON Gemini tanpa balasan");
    return { reply: parsed.balasan.trim(), reason: String(parsed.ringkasan_alasan ?? "").trim() };
  }
  return {
    model,
    // Coba dua kali, lalu jatuh ke template statis supaya hasil Jev tetap tampil.
    async writeReply(input) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return { ...(await once(input)), fallback: false };
        } catch (err) {
          console.warn(`[gemini] percobaan ${attempt + 1} gagal: ${err.message}`);
        }
      }
      return { reply: fallbackReply(input.category, input.tone), reason: "", fallback: true };
    },
  };
}

export function createMockGemini() {
  return {
    model: "mock/gemini",
    async writeReply({ category, tone }) {
      await new Promise((r) => setTimeout(r, 500));
      const reasons = {
        hoaks_kesehatan: "Klaim pengobatan tanpa bukti medis dan desakan untuk menyebarkan.",
        penipuan_berhadiah: "Menjanjikan hadiah dan meminta data atau klik tautan.",
        info_politik: "Klaim kebijakan tanpa sumber yang jelas.",
      };
      return { reply: fallbackReply(category, tone), reason: reasons[category] ?? "", fallback: false };
    },
  };
}
