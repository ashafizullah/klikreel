// Builds the single page that headless Chrome renders during export: every
// HTML/text clip as a layer, driven by window.__renderSeek(t).
import type { Clip, Project, Transform } from "../types/project";
import { buildFrameDoc } from "./frameRuntime";
import { resolveAssets } from "../store/images";
import { textLayerHtml } from "./textLayer";
import { clipEnd } from "./timeline";

export function transformCss(t: Transform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(${t.rotation}deg)`;
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export interface Composition {
  html: string;
  /** Merged [start, end) ranges where at least one overlay layer is visible. */
  ranges: [number, number][];
}

export function overlayClips(p: Project): Clip[] {
  // Bottom-most track first so later layers stack on top.
  return [...p.tracks]
    .reverse()
    .filter((t) => t.kind === "overlay" && !t.hidden)
    .flatMap((t) => t.clips);
}

export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function buildComposition(p: Project, images?: Record<string, string>): Composition | null {
  const clips = overlayClips(p);
  if (clips.length === 0) return null;
  const { width: W, height: H } = p;
  const layers: string[] = [];
  const meta = clips.map((c, i) => {
    const id = `L${i}`;
    const style = `transform:${transformCss(c.transform)}`;
    if (c.source.type === "html") {
      const doc = buildFrameDoc(c.source.html, c.source.params, resolveAssets(c.source.assetRefs, images));
      layers.push(`<div class="layer" id="${id}" style="${style}"><iframe srcdoc="${attr(doc)}"></iframe></div>`);
    } else if (c.source.type === "text") {
      layers.push(`<div class="layer" id="${id}" style="${style}">${textLayerHtml(c.source.text, c.source.style)}</div>`);
    }
    return {
      id,
      kind: c.source.type,
      start: c.start,
      end: clipEnd(c),
      trimIn: c.trimIn,
      duration: c.duration,
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
      opacity: c.transform.opacity,
    };
  });

  const script = `
const LAYERS = ${JSON.stringify(meta)};
function fade(L, lt) {
  let f = 1;
  if (L.fadeIn > 0) f = Math.min(f, lt / L.fadeIn);
  if (L.fadeOut > 0) f = Math.min(f, (L.duration - lt) / L.fadeOut);
  return Math.max(0, Math.min(1, f));
}
function frameWindow(L) { const f = document.querySelector("#" + L.id + " iframe"); return f && f.contentWindow; }
window.__ready = (async () => {
  const deadline = Date.now() + 15000;
  for (const L of LAYERS) {
    if (L.kind !== "html") continue;
    while (Date.now() < deadline) {
      const w = frameWindow(L);
      if (w && w.__frameReady) break;
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  await document.fonts.ready;
  return true;
})();
window.__renderSeek = async (t) => {
  let n = 0;
  for (const L of LAYERS) {
    const el = document.getElementById(L.id);
    const on = t >= L.start && t < L.end;
    el.style.display = on ? "block" : "none";
    if (!on) continue;
    n++;
    const lt = t - L.start;
    el.style.opacity = String(L.opacity * fade(L, lt));
    if (L.kind === "html") {
      const w = frameWindow(L);
      try { if (w && typeof w.__seek === "function") w.__seek(lt + L.trimIn); } catch (e) {}
    }
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return n;
};`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:transparent}
.layer{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:50% 50%;display:none}
.layer iframe{border:0;width:100%;height:100%;background:transparent;display:block}
</style></head><body>${layers.join("")}<script>${script}</script></body></html>`;

  return { html, ranges: mergeRanges(clips.map((c) => [c.start, clipEnd(c)])) };
}
