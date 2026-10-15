# Sift

*Saring sebelum sharing.*

Webapp untuk menilai risiko pesan berantai WhatsApp. Jev (lewat OpenRouter) memberi keputusan: jenis pesan, skor risiko, dan apakah pesan mendesak. Gemini menulis balasan santun untuk grup keluarga. Login memakai Firebase Authentication, data disimpan di Firebase Realtime Database, dan aplikasi di-deploy ke Render.

Spesifikasi lengkap ada di dokumen PRD dan Spesifikasi Teknis.

## Struktur

```text
public/            frontend statis (index.html, style.css, app.js)
src/
  server.js        wiring: memilih mode demo/live, AI asli/tiruan
  app.js           routing Express dan alur /api/analyze
  normalize.js     normalisasi teks, hash SHA-256, penyamaran data pribadi
  decision.js      logika keputusan atas jawaban Jev (ambang di sini)
  jev.js           klien Decisions API + Jev tiruan
  gemini.js        klien Gemini + template cadangan + Gemini tiruan
  store.js         Realtime Database (Admin SDK) + penyimpanan memori
scripts/eval.js    evaluasi akurasi Jev terhadap test/dataset.csv
test/              unit test dan integration test (node:test)
database.rules.json  security rules Realtime Database
render.yaml        konfigurasi deploy Render
```

## Tiga mode jalan

| Kondisi | Login | Data | AI |
| --- | --- | --- | --- |
| Tanpa variabel apa pun | Nama panggilan saja | Memori (hilang saat restart) | Tiruan |
| Hanya key AI diisi | Nama panggilan saja | Memori | Jev dan Gemini asli |
| Semua diisi | Firebase (Google, email) | Realtime Database | Jev dan Gemini asli |

Banner kuning di atas aplikasi menandai mode demo atau AI tiruan.

## Langkah 1: Jalankan di laptop (mode demo)

Butuh Node.js 22 atau lebih baru (`node -v`).

```bash
npm install
npm test
npm start
```

Buka http://localhost:3000, isi nama panggilan, lalu coba keempat contoh pesan.

Checkpoint: `npm test` menampilkan `pass 26`, `fail 0`, dan halaman login mode demo muncul.

## Langkah 2: Siapkan Firebase

1. Buka https://console.firebase.google.com, buat project baru.
2. **Authentication** > Get started > aktifkan provider **Google** dan **Email/Password**.
3. **Realtime Database** > Create database > pilih lokasi Singapura (asia-southeast1) > mulai dalam *locked mode*.
4. Di tab **Rules**, tempel isi `database.rules.json`, lalu **Publish**.
5. **Project settings** > Your apps > tambahkan **Web app**. Salin objek `firebaseConfig`.
6. **Project settings** > Service accounts > **Generate new private key**. File JSON terunduh.
7. Salin `.env.example` menjadi `.env`, lalu isi:
   - `FIREBASE_WEB_CONFIG`: objek `firebaseConfig` dalam format JSON satu baris (kunci pakai tanda kutip ganda).
   - `FIREBASE_SERVICE_ACCOUNT`: isi file JSON service account, dijadikan satu baris.
   - `FIREBASE_DATABASE_URL`: URL database dari halaman Realtime Database.

Cara cepat mengubah file JSON service account jadi satu baris:

```bash
node -e "console.log(JSON.stringify(require('./serviceAccount.json')))"
```

Checkpoint: `npm start` tidak lagi mencetak `MODE DEMO`, dan login Google berhasil di http://localhost:3000. Data muncul di Realtime Database di bawah `users/<uid>`.

## Langkah 3: Isi key AI

1. **OpenRouter**: buat akun di https://openrouter.ai, isi saldo secukupnya (misalnya US$2, tanpa auto top-up), buat API key. Isi `OPENROUTER_API_KEY`.
2. **Gemini**: buat API key di https://aistudio.google.com. Isi `GEMINI_API_KEY`. Pastikan nama model di `GEMINI_MODEL` tersedia untuk tier gratis akunmu.

Checkpoint: `npm start` tidak lagi mencetak `AI TIRUAN`, dan banner kuning hilang.

Tips: set `DEBUG_JEV=true` sekali untuk mencetak response mentah Jev di terminal. Cocokkan nama field (`choice`, `confidence`, `score`, `noul`) dengan yang dibaca `src/decision.js`.

## Langkah 4: Setel ambang Jev

1. Tambahkan pesan berantai asli ke `test/dataset.csv` sampai 40 baris (10 per kategori). Hapus data pribadi lebih dulu.
2. Jalankan `npm run eval`.
3. Lihat jawaban salah dan nilai keyakinannya, lalu ubah `THRESHOLDS` di `src/decision.js` bila perlu. Jalankan sekali lagi untuk melihat variasi antar-run.

Checkpoint: akurasi kategori minimal 80%, dan biaya total tercetak di akhir.

## Langkah 5: Deploy ke Render

1. Push folder ini ke repo GitHub (file `.env` otomatis diabaikan oleh `.gitignore`).
2. Di https://dashboard.render.com pilih **New > Blueprint**, sambungkan repo. Render membaca `render.yaml`.
3. Isi variabel rahasia saat diminta: `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_DATABASE_URL`, `FIREBASE_WEB_CONFIG`, `ALLOWED_ORIGIN` (isi dengan URL Render, misalnya `https://sift-app.onrender.com`).
4. Setelah deploy selesai, tambahkan domain Render ke **Firebase Authentication > Settings > Authorized domains**.

Checkpoint: `https://<app>.onrender.com/api/health` menjawab `{"ok":true,"mode":"live"}` dan login Google berhasil di domain Render.

Catatan: Web Service gratis Render tertidur bila lama tidak dipakai. Buka aplikasi beberapa menit sebelum demo.

## API

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/api/health` | Cek server hidup |
| GET | `/api/config` | Konfigurasi publik untuk frontend |
| POST | `/api/analyze` | `{ message, tone }`: analisis baru atau dari cache |
| POST | `/api/reply` | `{ analysisId, tone }`: tulis ulang balasan dengan nada lain |
| GET | `/api/history` | 20 analisis terakhir milik pengguna + kuota |
| DELETE | `/api/history/:id` | Hapus satu entri riwayat |
| POST | `/api/feedback` | `{ analysisId, label }`: laporan hasil keliru |

Semua endpoint selain `/api/health` dan `/api/config` membutuhkan header `Authorization: Bearer <Firebase ID token>`.

Perbedaan dari spesifikasi awal: riwayat dibaca dan dihapus lewat API server, tidak langsung dari klien ke database. Dengan begitu klien hanya memuat Firebase Auth, dan mode demo bisa memakai alur yang sama. Security rules tetap membatasi akses langsung bila suatu saat dibutuhkan.

## Privasi dan keamanan

- API key hanya ada di server (environment variable), tidak pernah di browser.
- Nomor HP, email, dan angka 16 digit disamarkan sebelum teks dikirim ke Jev dan Gemini.
- Cache bersama `messageCache` hanya menyimpan hash, tanpa teks pesan.
- Kuota 20 analisis baru per pengguna per hari (tanggal WIT). Hasil dari cache tidak menghabiskan kuota.
- Body request dibatasi 16 KB, dan semua teks pengguna di-escape sebelum ditampilkan.
