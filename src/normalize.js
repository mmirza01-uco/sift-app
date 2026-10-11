import { createHash } from "node:crypto";

// Karakter tak terlihat yang sering ikut tersalin dari WhatsApp.
const INVISIBLE = /[​-‏⁠﻿]/g;
// Penanda "Diteruskan" / "Forwarded" di baris pertama.
const FORWARD_MARK = /^\s*(diteruskan|forwarded|diteruskan berkali-kali|forwarded many times)\s*\n/i;
// Emoji dan simbol piktografik.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/gu;

/**
 * Normalisasi teks sebelum di-hash, sesuai spesifikasi:
 * hapus karakter tak terlihat, penanda forward, emoji, huruf kecil,
 * rapikan spasi, ringkas tanda baca berulang. URL dan angka dibiarkan.
 */
export function normalize(text) {
  return String(text)
    .replace(INVISIBLE, "")
    .replace(FORWARD_MARK, "")
    .replace(EMOJI, "")
    .toLowerCase()
    .replace(/([!?.,])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashMessage(text) {
  return createHash("sha256").update(normalize(text)).digest("hex");
}

/**
 * Samarkan data pribadi sebelum teks dikirim ke layanan AI pihak ketiga.
 * Teks asli tetap disimpan di riwayat milik pengguna.
 */
export function redact(text) {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[disamarkan]")
    .replace(/\b\d{16}\b/g, "[disamarkan]")
    .replace(/(\+62|62|0)8[\d\s-]{7,13}\d/g, "[disamarkan]");
}
