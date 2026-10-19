// Sift (Saring sebelum sharing): frontend (vanilla JS, ES module)
const FIREBASE_VERSION = "12.19.0";

const EXAMPLES = [
  "PENTING!!! Dokter dari rumah sakit ternama menemukan bahwa minum air rebusan bawang putih 3x sehari bisa membersihkan paru-paru dari virus dalam 2 hari. Sebarkan ke semua grup keluarga sebelum dihapus!!",
  "Selamat! Nomor WA Anda terpilih sebagai penerima Bantuan Sosial Rp3.500.000. Klik link bit.ly/bansos-cair2026 dan isi data KTP sebelum pukul 23.59 hari ini.",
  "Mulai bulan depan tarif listrik naik untuk semua golongan rumah tangga. Siap-siap ya keluarga.",
  "Assalamualaikum, besok arisan keluarga di rumah Tante Ani jam 4 sore. Jangan lupa bawa kue ya.",
];
const TONE_LABEL = { hormat: "Orang tua", netral: "Netral", santai: "Sepupu" };

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { config: null, user: null, getToken: null, signOut: null, tone: "hormat", result: null, history: [] };

// ---------- Penyimpanan per-browser (opsional) ----------
const local = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* abaikan */ } },
};

// ---------- Navigasi ----------
function show(name) {
  $$(".screen").forEach((s) => {
    const on = s.dataset.screen === name;
    s.hidden = !on;
    if (on) { s.classList.remove("fade"); void s.offsetWidth; s.classList.add("fade"); }
  });
  const loggedIn = !!state.user;
  $("#tabbar").hidden = !loggedIn || name === "login" || name === "boot";
  $("#bar-periksa").hidden = name !== "periksa";
  $("#bar-hasil").hidden = !(name === "hasil" && state.result?.reply);
  const tab = { periksa: "periksa", hasil: "periksa", loading: "periksa", riwayat: "riwayat", tentang: "tentang" }[name];
  $$(".tabbar button").forEach((b) => b.toggleAttribute("aria-current", b.dataset.go === tab));
  $$(".tabbar button[aria-current]").forEach((b) => b.setAttribute("aria-current", "page"));
  $("#scroll").scrollTop = 0;
  if (name === "riwayat") loadHistory();
  if (name === "akun") loadAkun();
}
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); show(g.dataset.go); }
});

function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------- API ----------
async function api(path, { method = "GET", body } = {}) {
  const token = await state.getToken();
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || "Terjadi kesalahan. Coba lagi.");
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Auth ----------
const AUTH_ERRORS = {
  "auth/invalid-credential": "Email atau kata sandi salah.",
  "auth/user-not-found": "Akun dengan email ini tidak ditemukan.",
  "auth/wrong-password": "Kata sandi salah.",
  "auth/email-already-in-use": "Email ini sudah terdaftar. Silakan masuk.",
  "auth/weak-password": "Kata sandi minimal 6 karakter.",
  "auth/invalid-email": "Format email tidak valid.",
  "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
  "auth/network-request-failed": "Koneksi internet bermasalah.",
  "app/email-not-verified": "Email belum diverifikasi. Kami kirim ulang tautannya, cek kotak masuk atau folder spam.",
  "auth/popup-closed-by-user": "Jendela login Google ditutup sebelum selesai.",
  "auth/popup-blocked": "Browser memblokir jendela login. Izinkan pop-up lalu coba lagi.",
};

function setAvatar(name) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  $("#avatar").textContent = initial;
  $("#avatar").setAttribute("aria-label", `Akun: ${name}. Buka pengaturan akun.`);
}

function onSignedIn(user) {
  state.user = user;
  setAvatar(user.name || user.email);
  show("periksa");
  refreshQuota();
  loadProfile();
}

async function setupDemoAuth() {
  $("#loginDemo").hidden = false;
  state.getToken = async () => `demo:${state.user?.name ?? ""}`;
  state.signOut = async () => { local.del("sift-demo-name"); };
  const saved = local.get("sift-demo-name");
  if (saved) { onSignedIn({ name: saved }); return; }
  show("login");
  $("#loginDemo").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#demoName").value.trim() || "Tamu";
    local.set("sift-demo-name", name);
    onSignedIn({ name });
  });
}

async function setupFirebaseAuth(firebaseConfig) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fa = await import(`${base}/firebase-auth.js`);
  const auth = fa.getAuth(initializeApp(firebaseConfig));
  auth.languageCode = "id";
  state.getToken = () => auth.currentUser.getIdToken();
  state.signOut = () => fa.signOut(auth);
  $("#loginFirebase").hidden = false;

  let registerMode = false;
  const err = $("#loginError");
  const notice = $("#loginNotice");
  const showNotice = (t) => { notice.textContent = t; notice.hidden = false; };
  const showErr = (e) => { err.textContent = AUTH_ERRORS[e.code] || "Gagal masuk. Coba lagi."; err.hidden = false; notice.hidden = true; };
  $("#modeToggle").addEventListener("click", () => {
    registerMode = !registerMode;
    $("#emailBtn").textContent = registerMode ? "Daftar" : "Masuk";
    $("#modeText").textContent = registerMode ? "Sudah punya akun?" : "Belum punya akun?";
    $("#modeToggle").textContent = registerMode ? "Masuk" : "Daftar";
    $("#pw").autocomplete = registerMode ? "new-password" : "current-password";
    err.hidden = true; notice.hidden = true;
  });
  $("#googleBtn").addEventListener("click", async () => {
    err.hidden = true;
    try { await fa.signInWithPopup(auth, new fa.GoogleAuthProvider()); } catch (e) { showErr(e); }
  });
  $("#emailForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const email = $("#em").value.trim(), pw = $("#pw").value;
    if (!email || pw.length < 6) { showErr({ code: !email ? "auth/invalid-email" : "auth/weak-password" }); return; }
    $("#emailBtn").disabled = true;
    try {
      if (registerMode) {
        const cred = await fa.createUserWithEmailAndPassword(auth, email, pw);
        // Webmailer: kirim tautan verifikasi, lalu arahkan kembali ke halaman login.
        await fa.sendEmailVerification(cred.user, { url: window.location.origin });
        await fa.signOut(auth);
        $("#modeToggle").click();
        showNotice(`Tautan verifikasi sudah dikirim ke ${email}. Klik tautan itu, lalu masuk.`);
      } else {
        const cred = await fa.signInWithEmailAndPassword(auth, email, pw);
        if (!cred.user.emailVerified) {
          await fa.sendEmailVerification(cred.user, { url: window.location.origin });
          await fa.signOut(auth);
          showErr({ code: "app/email-not-verified" });
        }
      }
    } catch (e2) { showErr(e2); } finally { $("#emailBtn").disabled = false; }
  });
  fa.onAuthStateChanged(auth, (u) => {
    // Akun email yang belum terverifikasi tidak boleh masuk ke aplikasi.
    if (u && !u.emailVerified) return;
    if (u) onSignedIn({ name: u.displayName || "", email: u.email || "" });
    else { state.user = null; show("login"); }
  });
}

$("#logout").addEventListener("click", async () => {
  await state.signOut?.();
  state.user = null; state.result = null; state.history = []; state.profile = null;
  show("login");
});

// ---------- Periksa ----------
const msg = $("#msg"), checkBtn = $("#check");
function setMsg(v) {
  msg.value = v;
  $("#cnt").textContent = v.length.toLocaleString("id-ID");
  checkBtn.disabled = v.trim().length < 20;
}
msg.addEventListener("input", () => setMsg(msg.value));
$$("[data-ex]").forEach((c) => c.addEventListener("click", () => setMsg(EXAMPLES[Number(c.dataset.ex)])));
$("#paste").addEventListener("click", async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) { setMsg(t.slice(0, 4000)); return; }
    toast("Clipboard kosong");
  } catch {
    msg.focus();
    toast("Tekan lama kotak teks lalu pilih Tempel");
  }
});

function setTone(t) {
  state.tone = t;
  $$("[data-tone]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tone === t)));
}
$("#toneInput").addEventListener("click", (e) => { const b = e.target.closest("[data-tone]"); if (b) setTone(b.dataset.tone); });

async function refreshQuota(q) {
  try {
    const quota = q ?? (await api("/api/history")).quota;
    const left = Math.max(0, quota.limit - quota.used);
    $("#quotaText").textContent = `Sisa kuota hari ini ${left} dari ${quota.limit}`;
    $("#quotaBar").style.width = `${(quota.used / quota.limit) * 100}%`;
    $("#quota").hidden = false;
  } catch { /* kuota opsional */ }
}

checkBtn.addEventListener("click", async () => {
  const errBox = $("#checkError");
  errBox.hidden = true;
  show("loading");
  const s1 = $("#st1"), s2 = $("#st2");
  s1.className = "active"; s2.className = "";
  const t = setTimeout(() => { s1.className = "done"; s2.className = "active"; }, 1200);
  try {
    const data = await api("/api/analyze", { method: "POST", body: { message: msg.value, tone: state.tone } });
    clearTimeout(t);
    s1.className = "done"; s2.className = data.reply ? "done" : "";
    state.result = { ...data, messageText: msg.value };
    renderResult();
    show("hasil");
    if (data.quota) refreshQuota(data.quota);
  } catch (e) {
    clearTimeout(t);
    show("periksa");
    errBox.innerHTML = `<span>${esc(e.message)}</span>`;
    errBox.hidden = false;
    if (e.status === 401) { state.user = null; show("login"); }
  }
});

// ---------- Hasil ----------
const ICON = {
  high: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v5m0 3.5h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  unsure: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  low: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const CHEV = '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LEVEL = { rendah: 1, sedang: 2, tinggi: 3 };
const pct = (v) => Math.round((v ?? 0) * 100);

function kindOf(r) {
  if (r.lowConfidence) return "unsure";
  if (r.riskLevel === "tinggi") return "high";
  if (r.riskLevel === "sedang") return "mid";
  return "low";
}

function renderResult() {
  const r = state.result;
  const kind = kindOf(r);
  const cat = r.categoryLabel.toLowerCase();
  const meta = {
    high: { badge: "Risiko tinggi", icon: ICON.high, title: `Kemungkinan besar ${esc(cat)}`, sub: "Sebaiknya jangan diteruskan. Kami sudah siapkan balasan yang santun." },
    mid: { badge: "Risiko sedang", icon: ICON.high, title: `Perlu hati-hati: ${esc(cat)}`, sub: "Pesan ini berpotensi menyesatkan. Balasan santun sudah disiapkan." },
    unsure: { badge: "Belum yakin", icon: ICON.unsure, title: "Kami belum bisa memastikan", sub: "Keyakinan Jev rendah, jadi kami tidak menulis balasan otomatis. Cek dulu ke situs cek fakta." },
    low: { badge: "Tampak aman", icon: ICON.low, title: "Pesan ini tampak aman", sub: "Tidak ada tanda hoaks atau penipuan. Tidak perlu membalas apa pun." },
  }[kind];

  const level = LEVEL[r.riskLevel] ?? 1;
  const segColor = { 1: "var(--safe)", 2: "var(--mid)", 3: "var(--high)" }[level];
  const meter = [1, 2, 3].map((i) => `<span style="background:${i <= level ? segColor : ""}"></span>`).join("");
  const lbl = ["Rendah", "Sedang", "Tinggi"].map((t, i) => `<span class="${i + 1 === level ? "on" : ""}">${t}</span>`).join("");

  let html = `
  <div class="verdict v-${kind}" role="status">
    <span class="badge">${meta.icon}${meta.badge}</span>
    <h2>${meta.title}</h2>
    <p>${meta.sub}</p>
    ${r.fromCache ? `<div class="cachebadge"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>Pesan ini sudah pernah diperiksa${r.hitCount > 1 ? ` ${r.hitCount} kali` : ""}. Hasil instan.</div>` : ""}
  </div>`;

  if (r.reply) {
    html += `
  <div class="card" style="margin-top:12px">
    <div class="eyebrow">Balasan siap kirim <span class="pill">ditulis Gemini</span></div>
    <div class="seg" role="group" aria-label="Nada balasan" id="toneResult">
      ${Object.keys(TONE_LABEL).map((t) => `<button type="button" data-tone="${t}" aria-pressed="${t === state.tone}">${TONE_LABEL[t]}</button>`).join("")}
    </div>
    <div class="bubblewrap">
      <div class="bubble" id="replyText">${esc(r.reply)}</div>
      <div class="regen" id="regen" hidden><span class="spin"></span>Gemini menulis ulang…</div>
    </div>
  </div>`;
  }
  if (r.lowConfidence && r.factCheckLinks?.length) {
    html += `
  <div class="card" style="margin-top:12px">
    <h3>Cek dulu sebelum menegur</h3>
    <p class="muted" style="margin:0 0 4px">Cari kabar ini di situs cek fakta:</p>
    <div class="links">${r.factCheckLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>`).join("")}</div>
  </div>`;
  }
  html += `
  <details class="detail" ${r.lowConfidence ? "open" : ""}>
    <summary><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="color:var(--brand)"><path d="M4 19V5m0 14h16M8 15v-3m4 3V9m4 6v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Detail penilaian Jev${CHEV}</summary>
    <div class="body">
      <div style="display:flex;justify-content:space-between;font-size:14px"><span class="muted">Tingkat risiko</span><b style="text-transform:capitalize">${esc(r.riskLevel)}</b></div>
      <div class="meter" role="img" aria-label="Risiko ${esc(r.riskLevel)}">${meter}</div>
      <div class="meterlbl">${lbl}</div>
      <div class="facts">
        <div class="fact"><small>Jenis pesan</small><b>${esc(r.categoryLabel)}</b></div>
        <div class="fact"><small>Mendesak bertindak?</small><b>${r.urgent ? "Ya" : "Tidak"}</b></div>
      </div>
      <div class="confrow"><span>Yakin jenis</span><span class="bar"><i style="width:${pct(r.confidence?.kategori)}%"></i></span><b>${pct(r.confidence?.kategori)}%</b></div>
      <div class="confrow"><span>Yakin risiko</span><span class="bar"><i style="width:${pct(r.confidence?.risiko)}%"></i></span><b>${pct(r.confidence?.risiko)}%</b></div>
      ${r.reason ? `<p class="why"><b>Alasan singkat:</b> ${esc(r.reason)}</p>` : ""}
      <p class="why" style="margin-top:12px"><b>Pesan yang diperiksa</b></p>
      <p class="original">${esc(r.messageText)}</p>
      <p class="why" style="margin-top:12px"><b>Teks yang dikirim ke AI</b></p>
      <p class="original">${esc(r.aiText ?? r.messageText).replaceAll("[disamarkan]", '<mark class="redacted">[disamarkan]</mark>')}</p>
      <p class="muted" style="font-size:13px;margin:6px 0 0">${r.aiText && r.aiText !== r.messageText ? "Nomor HP, email, NIK, rekening, dan alamat disamarkan sebelum dikirim." : "Tidak ada data pribadi yang terdeteksi."}</p>
    </div>
  </details>
  <p class="feedback">Penilaian ini keliru? <button type="button" id="fb">Laporkan</button></p>`;

  $("#result").innerHTML = html;
  setWa();
  $("#fb").addEventListener("click", sendFeedback);
  $("#toneResult")?.addEventListener("click", (e) => { const b = e.target.closest("[data-tone]"); if (b) changeTone(b.dataset.tone); });
}

function setWa() {
  const r = state.result;
  if (r?.reply) $("#wa").href = `https://wa.me/?text=${encodeURIComponent(r.reply)}`;
}

async function changeTone(tone) {
  if (tone === state.result.tone) return;
  setTone(tone);
  const box = $("#replyText");
  box.style.opacity = 0.35;
  $("#regen").hidden = false;
  try {
    const { reply } = await api("/api/reply", { method: "POST", body: { analysisId: state.result.analysisId, tone } });
    state.result.reply = reply;
    state.result.tone = tone;
    box.textContent = reply;
    setWa();
  } catch (e) {
    toast(e.message);
    setTone(state.result.tone);
  } finally {
    box.style.opacity = 1;
    $("#regen").hidden = true;
  }
}

async function sendFeedback() {
  const label = state.result.lowConfidence || state.result.riskLevel === "rendah" ? "salah_risiko" : "salah_kategori";
  try {
    await api("/api/feedback", { method: "POST", body: { analysisId: state.result.analysisId, label } });
    toast("Laporan tercatat. Ubah detailnya di menu Akun.");
    $("#fb").disabled = true;
  } catch (e) { toast(e.message); }
}

$("#copy").addEventListener("click", async () => {
  const text = state.result?.reply ?? "";
  try {
    await navigator.clipboard.writeText(text);
    toast("Balasan disalin. Tempel di WhatsApp.");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand?.("copy");
    ta.remove();
    toast(ok ? "Balasan disalin" : "Gagal menyalin. Tekan lama teks balasan untuk menyalin.");
  }
});

// ---------- Riwayat ----------
const TAG = (a) => {
  if (a.lowConfidence) return ["t-unsure", "Ragu"];
  if (a.riskLevel === "tinggi") return ["t-high", a.categoryLabel];
  if (a.riskLevel === "sedang") return ["t-mid", a.categoryLabel];
  return ["t-low", "Aman"];
};
const fmtDate = (ms) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

async function loadHistory() {
  const list = $("#hist");
  list.innerHTML = `<li><div style="flex:1"><div class="skel" style="margin-top:0;width:30%"></div><div class="skel"></div></div></li>`;
  try {
    const { items } = await api("/api/history");
    state.history = items;
    renderHistory();
  } catch (e) {
    list.innerHTML = `<li class="empty">${esc(e.message)}</li>`;
  }
}

function renderHistory() {
  const q = $("#q").value.trim().toLowerCase();
  const items = state.history.filter((a) => !q || String(a.messageText).toLowerCase().includes(q));
  if (!items.length) {
    $("#hist").innerHTML = `<li class="empty">${state.history.length ? "Tidak ada yang cocok." : "Belum ada pemeriksaan. Riwayatmu akan muncul di sini."}</li>`;
    return;
  }
  $("#hist").innerHTML = items.map((a) => {
    const [cls, tag] = TAG(a);
    return `<li>
      <button class="open" type="button" data-open="${esc(a.id)}"><span class="tag ${cls}">${esc(tag)}</span><p>${esc(a.preview)}</p><small>${a.createdAt ? fmtDate(a.createdAt) : ""}</small></button>
      <button class="iconbtn" type="button" data-del="${esc(a.id)}" aria-label="Hapus riwayat: ${esc(tag)}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    </li>`;
  }).join("");
}
$("#q").addEventListener("input", renderHistory);
$("#hist").addEventListener("click", async (e) => {
  const open = e.target.closest("[data-open]");
  if (open) {
    const a = state.history.find((x) => x.id === open.dataset.open);
    if (!a) return;
    state.result = { ...a, analysisId: a.id };
    if (a.tone) setTone(a.tone);
    renderResult();
    show("hasil");
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    try {
      await api(`/api/history/${encodeURIComponent(del.dataset.del)}`, { method: "DELETE" });
      state.history = state.history.filter((x) => x.id !== del.dataset.del);
      renderHistory();
      toast("Riwayat dihapus");
    } catch (err) { toast(err.message); }
  }
});

// ---------- Akun: profil ----------
const FB_LABEL = { salah_kategori: "Jenis pesan salah", salah_risiko: "Tingkat risiko salah", balasan_kurang_sopan: "Balasan kurang sopan" };
let pfTone = "hormat";
function setPfTone(t) {
  pfTone = t;
  $$("[data-pftone]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pftone === t)));
}
$("#pfTone").addEventListener("click", (e) => { const b = e.target.closest("[data-pftone]"); if (b) setPfTone(b.dataset.pftone); });

// Read: ambil profil, pakai nada bawaannya untuk halaman Periksa
async function loadProfile() {
  try {
    const p = await api("/api/profile");
    state.profile = p;
    setTone(p.defaultTone);
    if (p.displayName) setAvatar(p.displayName);
    return p;
  } catch { return null; }
}

async function loadAkun() {
  $("#profileError").hidden = true;
  const p = await loadProfile();
  if (p) {
    $("#pfName").value = p.displayName;
    setPfTone(p.defaultTone);
    $("#akunEmail").textContent = p.email ? `Masuk sebagai ${p.email}` : "Atur profil dan laporan penilaianmu.";
  }
  resetDelete();
  loadFeedback();
}

// Update: simpan nama panggilan dan nada bawaan
$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errBox = $("#profileError");
  errBox.hidden = true;
  const displayName = $("#pfName").value.trim();
  if (!displayName) { errBox.textContent = "Nama panggilan wajib diisi."; errBox.hidden = false; return; }
  $("#pfSave").disabled = true;
  try {
    const p = await api("/api/profile", { method: "PUT", body: { displayName, defaultTone: pfTone } });
    setTone(p.defaultTone);
    setAvatar(p.displayName);
    toast("Profil disimpan");
  } catch (err) {
    errBox.textContent = err.message; errBox.hidden = false;
  } finally { $("#pfSave").disabled = false; }
});

// Delete: hapus profil beserta riwayat dan laporan, lalu keluar. Ketuk dua kali untuk konfirmasi.
const delBtn = $("#delProfile");
function resetDelete() { delBtn.classList.remove("armed"); delBtn.textContent = "Hapus semua data saya"; }
delBtn.addEventListener("click", async () => {
  if (!delBtn.classList.contains("armed")) {
    delBtn.classList.add("armed");
    delBtn.textContent = "Ketuk sekali lagi untuk menghapus";
    return;
  }
  delBtn.disabled = true;
  try {
    await api("/api/profile", { method: "DELETE" });
    toast("Semua datamu sudah dihapus");
    $("#logout").click();
  } catch (err) { toast(err.message); } finally { delBtn.disabled = false; resetDelete(); }
});

// ---------- Akun: laporan penilaian keliru ----------
async function loadFeedback() {
  const list = $("#fbList");
  list.innerHTML = `<li><div class="skel" style="margin-top:0;width:40%"></div><div class="skel"></div></li>`;
  try {
    const { items } = await api("/api/feedback");
    if (!items.length) { list.innerHTML = `<li class="empty">Belum ada laporan.</li>`; return; }
    list.innerHTML = items.map((f) => `<li data-fb="${esc(f.id)}">
      <small>${f.createdAt ? fmtDate(f.createdAt) : ""}</small>
      <label class="sr-only" for="fbl-${esc(f.id)}">Jenis kesalahan</label>
      <select id="fbl-${esc(f.id)}" data-field="label">${Object.entries(FB_LABEL).map(([k, v]) => `<option value="${k}" ${k === f.label ? "selected" : ""}>${v}</option>`).join("")}</select>
      <label class="sr-only" for="fbn-${esc(f.id)}">Catatan</label>
      <input id="fbn-${esc(f.id)}" data-field="note" type="text" maxlength="300" placeholder="Catatan (opsional)" value="${esc(f.note)}">
      <div class="row">
        <button class="btn btn-outline btn-sm" type="button" data-fbsave>Simpan</button>
        <button class="btn btn-danger btn-sm" type="button" data-fbdel>Hapus</button>
      </div>
    </li>`).join("");
  } catch (e) {
    list.innerHTML = `<li class="empty">${esc(e.message)}</li>`;
  }
}

$("#fbList").addEventListener("click", async (e) => {
  const li = e.target.closest("[data-fb]");
  if (!li) return;
  const id = li.dataset.fb;
  if (e.target.closest("[data-fbsave]")) {
    const label = li.querySelector("[data-field=label]").value;
    const note = li.querySelector("[data-field=note]").value;
    try {
      await api(`/api/feedback/${encodeURIComponent(id)}`, { method: "PATCH", body: { label, note } });
      toast("Laporan diperbarui");
    } catch (err) { toast(err.message); }
  } else if (e.target.closest("[data-fbdel]")) {
    try {
      await api(`/api/feedback/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("Laporan dihapus");
      loadFeedback();
    } catch (err) { toast(err.message); }
  }
});

// ---------- Mulai ----------
(async function boot() {
  try {
    const res = await fetch("/api/config");
    state.config = await res.json();
  } catch {
    state.config = { demoMode: true, mockAi: true };
  }
  const notes = [];
  if (state.config.demoMode) notes.push("Mode demo: tanpa Firebase");
  if (state.config.mockAi) notes.push("AI tiruan, bukan Jev dan Gemini sungguhan");
  if (notes.length) { $("#demoBanner").textContent = notes.join(" · "); $("#demoBanner").hidden = false; }

  if (state.config.demoMode) await setupDemoAuth();
  else {
    try { await setupFirebaseAuth(state.config.firebase); }
    catch (e) { console.error(e); $("#demoBanner").textContent = "Gagal memuat Firebase. Periksa koneksi internet."; $("#demoBanner").hidden = false; show("login"); }
  }
})();
