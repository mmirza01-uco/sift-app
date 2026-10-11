// Penyimpanan data. Dua implementasi dengan antarmuka yang sama:
// - createRtdbStore: Firebase Realtime Database lewat Admin SDK (produksi)
// - createMemoryStore: in-memory untuk mode demo dan test

export function todayKey(date = new Date()) {
  // Tanggal WIT (Asia/Jayapura) dalam format YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jayapura" }).format(date);
}

export function createRtdbStore(db, ServerValue) {
  const now = () => ServerValue.TIMESTAMP;
  return {
    async upsertProfile(uid, profile) {
      const ref = db.ref(`users/${uid}/profile`);
      const snap = await ref.get();
      if (!snap.exists()) await ref.set({ ...profile, defaultTone: "hormat", createdAt: now() });
    },

    async getCache(hash) {
      const snap = await db.ref(`messageCache/${hash}`).get();
      return snap.exists() ? snap.val() : null;
    },
    async saveCache(hash, data) {
      await db.ref(`messageCache/${hash}`).set({ ...data, hitCount: 1, firstSeenAt: now(), lastSeenAt: now() });
    },
    async touchCache(hash) {
      await db.ref(`messageCache/${hash}/hitCount`).transaction((n) => (n || 0) + 1);
      await db.ref(`messageCache/${hash}/lastSeenAt`).set(now());
    },
    async setCacheReply(hash, tone, reply) {
      await db.ref(`messageCache/${hash}/replies/${tone}`).set(reply);
    },
    async setCacheReason(hash, reason) {
      await db.ref(`messageCache/${hash}/reason`).set(reason);
    },

    async addAnalysis(uid, data) {
      const ref = db.ref(`users/${uid}/analyses`).push();
      // RTDB tidak menyimpan null: buang field kosong
      const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined));
      await ref.set({ ...clean, createdAt: now() });
      return ref.key;
    },
    async getAnalysis(uid, id) {
      const snap = await db.ref(`users/${uid}/analyses/${id}`).get();
      return snap.exists() ? { id, ...snap.val() } : null;
    },
    async updateAnalysis(uid, id, patch) {
      await db.ref(`users/${uid}/analyses/${id}`).update(patch);
    },
    async listAnalyses(uid, limit = 20) {
      const snap = await db.ref(`users/${uid}/analyses`).orderByChild("createdAt").limitToLast(limit).get();
      const items = [];
      snap.forEach((child) => { items.push({ id: child.key, ...child.val() }); });
      return items.reverse();
    },
    async deleteAnalysis(uid, id) {
      await db.ref(`users/${uid}/analyses/${id}`).remove();
    },

    async takeQuota(uid, limit) {
      const ref = db.ref(`quota/${uid}/${todayKey()}`);
      const result = await ref.transaction((n) => ((n || 0) >= limit ? undefined : (n || 0) + 1));
      const used = result.snapshot.val() || 0;
      return { allowed: result.committed, used };
    },
    async peekQuota(uid) {
      const snap = await db.ref(`quota/${uid}/${todayKey()}`).get();
      return snap.val() || 0;
    },

    async addFeedback(uid, data) {
      await db.ref(`feedback/${uid}`).push({ ...data, createdAt: now() });
    },
  };
}

export function createMemoryStore() {
  const profiles = new Map(), cache = new Map(), analyses = new Map(), quota = new Map(), feedback = [];
  let seq = 0;
  const userMap = (uid) => { if (!analyses.has(uid)) analyses.set(uid, new Map()); return analyses.get(uid); };
  return {
    _dump: () => ({ profiles, cache, analyses, quota, feedback }),
    async upsertProfile(uid, profile) { if (!profiles.has(uid)) profiles.set(uid, { ...profile, createdAt: Date.now() }); },
    async getCache(hash) { return cache.has(hash) ? structuredClone(cache.get(hash)) : null; },
    async saveCache(hash, data) { cache.set(hash, { ...structuredClone(data), hitCount: 1, firstSeenAt: Date.now(), lastSeenAt: Date.now() }); },
    async touchCache(hash) { const c = cache.get(hash); if (c) { c.hitCount += 1; c.lastSeenAt = Date.now(); } },
    async setCacheReply(hash, tone, reply) { const c = cache.get(hash); if (c) c.replies = { ...(c.replies || {}), [tone]: reply }; },
    async setCacheReason(hash, reason) { const c = cache.get(hash); if (c) c.reason = reason; },
    async addAnalysis(uid, data) {
      const id = `a${Date.now().toString(36)}${(seq++).toString(36)}`;
      userMap(uid).set(id, { ...structuredClone(data), createdAt: Date.now() + seq });
      return id;
    },
    async getAnalysis(uid, id) { const a = userMap(uid).get(id); return a ? { id, ...structuredClone(a) } : null; },
    async updateAnalysis(uid, id, patch) { const a = userMap(uid).get(id); if (a) Object.assign(a, patch); },
    async listAnalyses(uid, limit = 20) {
      return [...userMap(uid).entries()].map(([id, a]) => ({ id, ...structuredClone(a) }))
        .sort((x, y) => y.createdAt - x.createdAt).slice(0, limit);
    },
    async deleteAnalysis(uid, id) { userMap(uid).delete(id); },
    async takeQuota(uid, limit) {
      const key = `${uid}/${todayKey()}`, n = quota.get(key) || 0;
      if (n >= limit) return { allowed: false, used: n };
      quota.set(key, n + 1);
      return { allowed: true, used: n + 1 };
    },
    async peekQuota(uid) { return quota.get(`${uid}/${todayKey()}`) || 0; },
    async addFeedback(uid, data) { feedback.push({ uid, ...data, createdAt: Date.now() }); },
  };
}
