// Lightweight i18n: English (default) and Indonesian.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import en, { type Key } from "./en";
import id from "./id";

export type { Key };
export type Locale = "en" | "id";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "EN" },
  { id: "id", label: "ID" },
];

const dicts: Record<Locale, Record<Key, string>> = { en, id };

export const useLocale = create<{ locale: Locale; setLocale(l: Locale): void }>()(
  persist((set) => ({ locale: "en", setLocale: (locale) => set({ locale }) }), { name: "klikreel-locale" }),
);

export type Vars = Record<string, string | number>;

export function translate(locale: Locale, key: Key, vars?: Vars): string {
  const text = dicts[locale][key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Non-reactive lookup for code outside React components. */
export const t = (key: Key, vars?: Vars) => translate(useLocale.getState().locale, key, vars);

/** Reactive lookup: components re-render when the locale changes. */
export function useT() {
  const locale = useLocale((s) => s.locale);
  return (key: Key, vars?: Vars) => translate(locale, key, vars);
}

// Backend (Rust) errors are English; map the known ones for Indonesian.
const BACKEND_ID: [RegExp, string][] = [
  [/^This profile has no API key yet \(AI Settings\)$/, "API key profil ini belum diisi (Pengaturan AI)"],
  [/^ffmpeg not found\. Install it: (.*)$/, "ffmpeg tidak ditemukan. Instal dulu: $1"],
  [/^ffprobe not found\. Install it: (.*)$/, "ffprobe tidak ditemukan. Instal dulu: $1"],
  [/^Invalid profile id$/, "ID profil tidak valid"],
  [/^Invalid id$/, "ID tidak valid"],
  [/^Folder not found$/, "Folder tidak ditemukan"],
  [/^Choose a folder$/, "Pilih folder"],
  [/^Workspace not found$/, "Workspace tidak ditemukan"],
  [/^Workspace folder not found$/, "Folder workspace tidak ditemukan"],
  [/^Paths outside the workspace are not allowed$/, "Path di luar workspace tidak diizinkan"],
  [/^Not found: (.*)$/, "Tidak ditemukan: $1"],
  [/^This file holds credentials and cannot be read$/, "File ini berisi kredensial dan tidak boleh dibaca"],
  [/^Binary files cannot be read as text$/, "File biner tidak bisa dibaca sebagai teks"],
  [/^Could not load image (.*)$/, "Gagal memuat gambar $1"],
  [/^Not a supported image file$/, "Bukan file gambar yang didukung"],
  [/^Another render is already running$/, "Render lain sedang berjalan"],
  [/^Google Chrome \/ Chromium not found\..*$/, "Google Chrome / Chromium tidak ditemukan. Instal Chrome untuk merender scene HTML."],
  [/^The timeline is empty$/, "Timeline kosong"],
  [/^Preparing headless Chrome…$/, "Menyiapkan Chrome headless…"],
  [/^Rendering…$/, "Merender…"],
  [/^Render cancelled$/, "Render dibatalkan"],
  [/^ffmpeg failed:/, "ffmpeg gagal:"],
  [/^Narration script is empty$/, "Naskah narasi kosong"],
  [/^Empty TTS response$/, "Respons TTS kosong"],
  [/^Unknown API format: (.*)$/, "Format API tidak dikenal: $1"],
  [/^The model declined this request\. Try rephrasing the prompt\.$/, "Model menolak permintaan ini. Coba ubah prompt."],
  [/^The AI did not return HTML$/, "AI tidak mengembalikan HTML"],
  [/^Unsupported media format$/, "Format media tidak didukung"],
  [/^Invalid TTS audio: (.*)$/, "Audio TTS tidak valid: $1"],
  [/^Invalid file name$/, "Nama file tidak valid"],
  [/^Could not open Terminal$/, "Gagal membuka Terminal"],
  [/^Opening Terminal is only supported on macOS$/, "Membuka Terminal hanya didukung di macOS"],
  [/^Unknown dependency: (.*)$/, "Dependensi tidak dikenal: $1"],
  [/^Chrome: (.*)$/s, "Chrome gagal: $1"],
  [/^Anthropic: (.*)$/s, "Anthropic menolak permintaan: $1"],
  [/^HTTP (\d+)([^:]*): (.*)$/s, "Permintaan gagal (HTTP $1$2): $3"],
  [/^SVG is too large$/, "File SVG terlalu besar"],
  [/^File is too large to load into memory$/, "File terlalu besar untuk dimuat"],
  [/^Tempo must be between 0\.5 and 2\.0$/, "Tempo harus antara 0,5 dan 2,0"],
  [/^No such file or directory \(os error 2\)$/, "File atau folder tidak ditemukan"],
  [/^error sending request for url (.*)$/s, "Gagal menghubungi server $1. Periksa koneksi internet atau Base URL."],
  [/^operation timed out$/i, "Waktu tunggu habis. Coba lagi."],
  [/^Base URL must start with http:\/\/ or https:\/\/ \(got (.*)\)\. For xAI use (.*)$/, "Base URL harus diawali http:// atau https:// (sekarang $1). Untuk xAI pakai $2"],
];

export function localizeMessage(message: string): string {
  if (useLocale.getState().locale !== "id") return message;
  for (const [re, out] of BACKEND_ID) if (re.test(message)) return message.replace(re, out);
  return message;
}
