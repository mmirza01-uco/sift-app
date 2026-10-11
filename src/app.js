import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashMessage, redact } from "./normalize.js";
import { decide, CATEGORY_LABEL } from "./decision.js";
import { TONES } from "./gemini.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const FACT_CHECK_LINKS = [
  { label: "TurnBackHoax (Mafindo)", url: "https://turnbackhoax.id" },
  { label: "CekFakta.com", url: "https://cekfakta.com" },
];
const DAY_MS = 24 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/**
 * Membangun aplikasi Express. Semua dependensi disuntikkan supaya bisa diuji tanpa jaringan.
 * @param {{store, jev, gemini, verifyToken, config}} deps
 */
export function createApp({ store, jev, gemini, verifyToken, config }) {
  const cfg = { dailyQuota: 20, cacheTtlDays: 30, allowedOrigin: "", publicConfig: {}, ...config };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  // Header keamanan dasar
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.set("X-Frame-Options", "DENY");
    if (cfg.allowedOrigin && req.headers.origin === cfg.allowedOrigin) {
      res.set("Access-Control-Allow-Origin", cfg.allowedOrigin);
      res.set("Vary", "Origin");
    }
    next();
  });

  // ---------- Publik ----------
  app.get("/api/health", (req, res) => res.json({ ok: true, mode: cfg.publicConfig.demoMode ? "demo" : "live" }));
  app.get("/api/config", (req, res) => res.json(cfg.publicConfig));

  // ---------- Auth ----------
  const auth = async (req, res, next) => {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return next(new HttpError(401, "unauthenticated", "Silakan masuk terlebih dahulu."));
    try {
      req.user = await verifyToken(token);
      next();
    } catch {
      next(new HttpError(401, "unauthenticated", "Sesi tidak valid. Silakan masuk ulang."));
    }
  };

  const toneOf = (t) => {
    if (t === undefined) return "hormat";
    if (!TONES.includes(t)) throw new HttpError(400, "invalid_input", "Nada balasan tidak dikenal.");
    return t;
  };

  const shape = (id, a, extra = {}) => ({
    analysisId: id,
    fromCache: !!a.fromCache,
    category: a.category,
    categoryLabel: CATEGORY_LABEL[a.category] ?? a.category,
    riskLevel: a.riskLevel,
    riskScore: a.riskScore,
    urgent: (a.urgentProb ?? 0) >= 0.6,
    confidence: a.confidence,
    lowConfidence: !!a.lowConfidence,
    tone: a.tone,
    reply: a.reply ?? null,
    reason: a.reason ?? "",
    factCheckLinks: a.lowConfidence ? FACT_CHECK_LINKS : [],
    ...extra,
  });

  app.post("/api/analyze", auth, async (req, res) => {
    const { message, tone: rawTone } = req.body ?? {};
    if (typeof message !== "string" || message.trim().length < 20)
      throw new HttpError(400, "invalid_input", "Pesan minimal 20 karakter.");
    if (message.length > 4000) throw new HttpError(400, "invalid_input", "Pesan maksimal 4.000 karakter.");
    const tone = toneOf(rawTone);
    const { uid } = req.user;
    await store.upsertProfile(uid, { displayName: req.user.name ?? "", email: req.user.email ?? "" });

    const hash = hashMessage(message);
    let cached = await store.getCache(hash);
    const fresh = cached
      && cached.jevModel === jev.model
      && Date.now() - (cached.firstSeenAt ?? 0) < cfg.cacheTtlDays * DAY_MS;
    let decision, reason = "", fromCache = false, hitCount = 1;

    if (fresh) {
      decision = cached.derived;
      reason = cached.reason ?? "";
      fromCache = true;
      hitCount = (cached.hitCount ?? 1) + 1;
      await store.touchCache(hash);
    } else {
      const quota = await store.takeQuota(uid, cfg.dailyQuota);
      if (!quota.allowed)
        throw new HttpError(429, "quota_exceeded", `Kuota ${cfg.dailyQuota} pemeriksaan baru hari ini sudah habis. Coba lagi besok.`);
      const safeText = redact(message);
      const result = await jev.assess(safeText); // AiError -> 502
      decision = decide(result.answers);
      cached = {
        jev: result.answers,
        jevModel: jev.model,
        jevSnapshot: result.model ?? "",
        derived: decision,
        replies: {},
        costUsd: result.costUsd ?? 0,
      };
      await store.saveCache(hash, cached);
    }

    let reply = null;
    if (decision.needsReply) {
      reply = cached.replies?.[tone] ?? null;
      if (!reply) {
        const out = await gemini.writeReply({ tone, category: decision.category, riskLevel: decision.riskLevel, urgent: decision.urgent, message: redact(message) });
        reply = out.reply;
        if (out.reason) reason = out.reason;
        if (!out.fallback) {
          await store.setCacheReply(hash, tone, reply);
          if (out.reason && !cached.reason) await store.setCacheReason(hash, out.reason);
        }
      }
    }

    const record = {
      messageHash: hash,
      messageText: message,
      category: decision.category,
      riskLevel: decision.riskLevel,
      riskScore: decision.riskScore,
      urgentProb: decision.urgentProb,
      confidence: decision.confidence,
      lowConfidence: decision.lowConfidence,
      needsReply: decision.needsReply,
      tone,
      reply,
      reason,
      fromCache,
    };
    const id = await store.addAnalysis(uid, record);
    const used = await store.peekQuota(uid);
    res.json(shape(id, record, { hitCount, quota: { used, limit: cfg.dailyQuota } }));
  });

  app.post("/api/reply", auth, async (req, res) => {
    const { analysisId, tone: rawTone } = req.body ?? {};
    const tone = toneOf(rawTone);
    if (typeof analysisId !== "string" || !/^[\w-]{1,64}$/.test(analysisId))
      throw new HttpError(400, "invalid_input", "analysisId tidak valid.");
    const a = await store.getAnalysis(req.user.uid, analysisId);
    if (!a) throw new HttpError(404, "not_found", "Analisis tidak ditemukan.");
    if (!a.needsReply) throw new HttpError(400, "invalid_input", "Pesan ini tidak memerlukan balasan.");
    const cached = await store.getCache(a.messageHash);
    let reply = cached?.replies?.[tone];
    if (!reply) {
      const out = await gemini.writeReply({ tone, category: a.category, riskLevel: a.riskLevel, urgent: (a.urgentProb ?? 0) >= 0.6, message: redact(a.messageText) });
      reply = out.reply;
      if (!out.fallback && cached) await store.setCacheReply(a.messageHash, tone, reply);
    }
    await store.updateAnalysis(req.user.uid, analysisId, { tone, reply });
    res.json({ reply, tone });
  });

  app.get("/api/history", auth, async (req, res) => {
    const items = await store.listAnalyses(req.user.uid, 20);
    res.json({
      items: items.map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        preview: String(a.messageText ?? "").slice(0, 160),
        ...shape(a.id, a),
        messageText: a.messageText,
      })),
      quota: { used: await store.peekQuota(req.user.uid), limit: cfg.dailyQuota },
    });
  });

  app.delete("/api/history/:id", auth, async (req, res) => {
    if (!/^[\w-]{1,64}$/.test(req.params.id)) throw new HttpError(400, "invalid_input", "ID tidak valid.");
    await store.deleteAnalysis(req.user.uid, req.params.id);
    res.status(204).end();
  });

  app.post("/api/feedback", auth, async (req, res) => {
    const { analysisId, label } = req.body ?? {};
    const LABELS = ["salah_kategori", "salah_risiko", "balasan_kurang_sopan"];
    if (!LABELS.includes(label) || typeof analysisId !== "string")
      throw new HttpError(400, "invalid_input", "Umpan balik tidak valid.");
    await store.addFeedback(req.user.uid, { analysisId, label });
    res.status(204).end();
  });

  app.use("/api", (req, res, next) => next(new HttpError(404, "not_found", "Endpoint tidak ditemukan.")));

  // ---------- Frontend statis ----------
  app.use(express.static(PUBLIC_DIR, { extensions: ["html"], maxAge: "1h" }));

  // ---------- Error handler ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") err = new HttpError(413, "invalid_input", "Pesan terlalu besar.");
    if (err.type === "entity.parse.failed") err = new HttpError(400, "invalid_input", "Format JSON tidak valid.");
    if (err.code === "ai_unavailable") {
      console.error("[ai]", err.message);
      err = new HttpError(502, "ai_unavailable", "Penilaian sedang tidak tersedia. Coba beberapa saat lagi.");
    }
    if (!(err instanceof HttpError)) {
      console.error("[internal]", err);
      err = new HttpError(500, "internal", "Terjadi kesalahan di server.");
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
  });

  return app;
}
