import { createApp } from "./app.js";
import { createJevClient, createMockJev } from "./jev.js";
import { createGeminiClient, createMockGemini } from "./gemini.js";
import { createMemoryStore, createRtdbStore } from "./store.js";

const env = process.env;
const PORT = Number(env.PORT) || 3000;

// Mode demo aktif bila DEMO_MODE=true atau kredensial Firebase belum diisi.
const hasFirebase = !!(env.FIREBASE_SERVICE_ACCOUNT && env.FIREBASE_DATABASE_URL && env.FIREBASE_WEB_CONFIG);
const demoMode = env.DEMO_MODE === "true" || !hasFirebase;

let store, verifyToken, publicConfig;

if (demoMode) {
  store = createMemoryStore();
  // Di mode demo, token berbentuk "demo:<nama>" dan diterima tanpa verifikasi.
  verifyToken = async (token) => {
    if (!token.startsWith("demo:")) throw new Error("bukan token demo");
    const name = token.slice(5).slice(0, 40) || "Tamu";
    return { uid: `demo-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`, name, email: "" };
  };
  publicConfig = { demoMode: true };
  console.log("[sift] MODE DEMO: login tanpa Firebase, data disimpan di memori.");
} else {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getDatabase, ServerValue } = await import("firebase-admin/database");
  const app = initializeApp({
    credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: env.FIREBASE_DATABASE_URL,
  });
  store = createRtdbStore(getDatabase(app), ServerValue);
  const auth = getAuth(app);
  verifyToken = async (token) => {
    const t = await auth.verifyIdToken(token);
    // Akun email/kata sandi wajib sudah klik tautan verifikasi (login Google selalu terverifikasi).
    if (t.email && !t.email_verified) throw new Error("email belum diverifikasi");
    return { uid: t.uid, name: t.name ?? "", email: t.email ?? "" };
  };
  publicConfig = { demoMode: false, firebase: JSON.parse(env.FIREBASE_WEB_CONFIG) };
}

const useMockAi = env.MOCK_AI === "true" || !env.OPENROUTER_API_KEY || !env.GEMINI_API_KEY;
const jev = useMockAi
  ? createMockJev()
  : createJevClient({ apiKey: env.OPENROUTER_API_KEY, model: env.JEV_MODEL || "typesafe/jev-1.13", debug: env.DEBUG_JEV === "true" });
const gemini = useMockAi
  ? createMockGemini()
  : createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-3.5-flash-lite" });
if (useMockAi) console.log("[sift] AI TIRUAN: isi OPENROUTER_API_KEY dan GEMINI_API_KEY untuk memakai Jev dan Gemini sungguhan.");
publicConfig.mockAi = useMockAi;

const app = createApp({
  store, jev, gemini, verifyToken,
  config: {
    dailyQuota: Number(env.DAILY_QUOTA) || 20,
    cacheTtlDays: Number(env.CACHE_TTL_DAYS) || 30,
    allowedOrigin: env.ALLOWED_ORIGIN || "",
    publicConfig,
  },
});

app.listen(PORT, () => console.log(`[sift] berjalan di http://localhost:${PORT}`));
