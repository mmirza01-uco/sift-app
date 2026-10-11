// Klien Jev lewat Decisions API OpenRouter.
// Dokumentasi: https://openrouter.ai/docs/guides/community/jev-tutorial
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

export function buildJevRequest(message, model) {
  return {
    model,
    state: {
      pesan: message,
      konteks: "Pesan berantai yang diteruskan di grup WhatsApp keluarga Indonesia",
    },
    questions: {
      kategori: {
        type: "choice",
        instructions: "Tentukan jenis pesan ini.",
        criteria: {
          hoaks_kesehatan: "Klaim kesehatan, obat, vaksin, atau penyakit yang tidak didukung bukti medis",
          penipuan_berhadiah: "Hadiah, undian, bantuan dana, atau lowongan yang meminta data, transfer, atau klik tautan",
          info_politik: "Klaim tentang tokoh, partai, pemilu, atau kebijakan pemerintah yang memancing emosi",
          aman: "Informasi biasa, ucapan, atau kabar keluarga tanpa klaim berisiko",
        },
      },
      risiko: {
        type: "score",
        instructions: "Seberapa besar kemungkinan pesan ini merugikan pembaca bila dipercaya atau diteruskan?",
        criteria: ["rendah", "sedang", "tinggi"],
      },
      mendesak: {
        type: "noul",
        instructions: "Apakah pesan mendesak pembaca untuk segera bertindak?",
        criteria: {
          true: "Ada desakan seperti sebarkan sekarang, klik segera, transfer hari ini, atau batas waktu",
          false: "Tidak ada desakan untuk bertindak segera",
        },
      },
    },
  };
}

export class AiError extends Error {
  constructor(message, cause) {
    super(message);
    this.code = "ai_unavailable";
    this.cause = cause;
  }
}

export function createJevClient({ apiKey, model, timeoutMs = 10_000, debug = false }) {
  return {
    model,
    async assess(message) {
      let res;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildJevRequest(message, model)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new AiError("Jev tidak merespons", err);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new AiError(`Jev HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      if (debug) console.log("[jev] response", JSON.stringify(data));
      if (!data?.answers) throw new AiError("Response Jev tanpa field answers");
      return { answers: data.answers, model: data.model ?? model, costUsd: data.usage?.cost ?? 0 };
    },
  };
}

// Jev tiruan untuk mode demo: heuristik kata kunci, bukan penilaian sungguhan.
export function createMockJev() {
  const has = (t, words) => words.some((w) => t.includes(w));
  return {
    model: "mock/jev",
    async assess(message) {
      const t = message.toLowerCase();
      const urgent = has(t, ["sebarkan", "viralkan", "segera", "sebelum dihapus", "hari ini", "sebelum pukul", "sebelum jam"]);
      let choice = "aman", score = 0.2, ck = 0.9, cr = 0.85;
      if (has(t, ["bansos", "hadiah", "selamat!", "klik", "link", "bit.ly", "transfer", "ktp", "undian", "terpilih"])) {
        choice = "penipuan_berhadiah"; score = 1.85; ck = 0.93; cr = 0.86;
      } else if (has(t, ["obat", "sembuh", "virus", "kanker", "dokter", "vaksin", "paru", "rebusan"])) {
        choice = "hoaks_kesehatan"; score = 1.75; ck = 0.9; cr = 0.78;
      } else if (has(t, ["pemilu", "presiden", "partai", "tarif", "pemerintah", "naik", "menteri"])) {
        choice = "info_politik"; score = 1.0; ck = 0.48; cr = 0.42;
      }
      await new Promise((r) => setTimeout(r, 400));
      return {
        answers: {
          kategori: { type: "choice", choice, confidence: ck },
          risiko: { type: "score", score, confidence: cr },
          mendesak: { type: "noul", noul: urgent ? 0.9 : 0.1 },
        },
        model: "mock/jev",
        costUsd: 0,
      };
    },
  };
}
