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

const MASK = "[disamarkan]";
// Potongan alamat: kata berhuruf kapital, singkatan bertitik, "No.", angka, atau "/" dan "-".
const ADDR_TOKEN = String.raw`(?:[A-Z][\w'-]*\.?|No\.?|\d+[A-Za-z]?|[/-])`;
const ADDR_TAIL = String.raw`(?:\s*${ADDR_TOKEN}){0,7}`;

/**
 * Samarkan data pribadi sebelum teks dikirim ke layanan AI pihak ketiga.
 * Teks asli tetap disimpan di riwayat milik pengguna.
 * Tautan, nominal uang, dan tanggal dibiarkan karena menjadi petunjuk penipuan.
 * Nama orang hanya disamarkan bila didahului "a.n." atau "atas nama".
 */
export function redact(text) {
  return String(text)
    // Email
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, MASK)
    // NIK atau nomor kartu 16 digit, boleh dipisah spasi, titik, atau strip
    .replace(/\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g, MASK)
    // Nomor rekening setelah kata kunci bank
    .replace(/(\b(?:no\.?\s*)?(?:rekening|rek\.?|norek|bca|bri|bni|mandiri|bsi|btn|cimb(?:\s+niaga)?|danamon|permata)\s*(?:no\.?\s*)?:?\s*)\d[\d\s-]{4,18}\d/gi, `$1${MASK}`)
    // Nama pemilik setelah "a.n." atau "atas nama"
    .replace(/(\b(?:a\.n\.?|a\/n|[Aa]tas [Nn]ama)\s*:?\s*)[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3}/g, `$1${MASK}`)
    // Alamat: jalan, gang, RT/RW, kelurahan, kecamatan, desa, perumahan, blok
    .replace(new RegExp(String.raw`\b(?:Jl|Jln|Gg|Kel|Kec|Perum|Komp|Blok)\.?\s+${ADDR_TOKEN}${ADDR_TAIL}`, "g"), MASK)
    .replace(new RegExp(String.raw`\b(?:Jalan|Gang|Kelurahan|Kecamatan|Desa|Perumahan|Kompleks)\s+[A-Z][\w'-]*\.?${ADDR_TAIL}`, "g"), MASK)
    .replace(/\bRT\.?\s*\d{1,3}(?:\s*\/\s*RW\.?\s*\d{1,3})?|\bRW\.?\s*\d{1,3}/gi, MASK)
    // Nomor HP: 08xx, 628xx, +62 8xx, dengan spasi, titik, strip, atau kurung
    .replace(/(?:\+62\s?|\b62|\(?\b0)\(?8\d{1,2}\)?(?:[\s.-]?\d){6,10}/g, MASK)
    // Telepon rumah atau kantor: (021) 5551234, 0274-123456, +62 21 5551234
    .replace(/(?:\+62\s?\(?|\(?\b0)[2-79]\d{1,2}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g, MASK);
}
