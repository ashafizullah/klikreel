export const MIN_CLIP = 0.1;

/** 75.5 → "01:15.50" (or "1:01:15.50" past an hour). */
export function formatTime(sec: number, withFrac = true): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const ss = withFrac ? r.toFixed(2).padStart(5, "0") : String(Math.floor(r)).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Bytes as megabytes, e.g. "1.24 MB". */
export function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
