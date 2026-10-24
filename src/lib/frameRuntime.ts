// The HTML Frame contract: every frame document defines window.__seek(t).
// This runtime is injected into each frame, both in the preview iframes and
// in the headless-Chrome composition, so preview and export match.
import gsapSource from "gsap/dist/gsap.min.js?raw";

const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

const RUNTIME = `
window.__params = __PARAMS__;
window.__assets = __ASSETS__;
if (typeof window.__seek !== "function") window.__seek = function () {};
if (window.gsap) { gsap.ticker.lagSmoothing(0); gsap.ticker.sleep(); }
window.addEventListener("message", function (e) {
  var d = e.data;
  if (d && d.type === "klikreel:seek" && typeof window.__seek === "function") {
    try { window.__seek(d.t); } catch (err) { parent.postMessage({ type: "klikreel:error", message: String(err) }, "*"); }
  }
});
window.addEventListener("error", function (e) { parent.postMessage({ type: "klikreel:error", message: e.message }, "*"); });
window.addEventListener("load", function () {
  window.__frameReady = true;
  try { window.__seek(0); } catch (e) {}
  parent.postMessage({ type: "klikreel:ready" }, "*");
});
`;

function escapeScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

export function frameHead(params: Record<string, string>, assets: Record<string, string> = {}): string {
  const runtime = RUNTIME.replace("__PARAMS__", escapeScript(JSON.stringify(params ?? {}))).replace(
    "__ASSETS__",
    escapeScript(JSON.stringify(assets)),
  );
  return (
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` +
    `<script>${escapeScript(gsapSource)}</script><script>${runtime}</script>`
  );
}

/** Wraps an AI/user HTML document so the runtime loads before its own scripts. */
export function buildFrameDoc(html: string, params: Record<string, string>, assets: Record<string, string> = {}): string {
  const head = frameHead(params, assets);
  const headTag = html.match(/<head[^>]*>/i);
  if (headTag) return html.replace(headTag[0], headTag[0] + head);
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag) return html.replace(htmlTag[0], `${htmlTag[0]}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body style="margin:0;background:transparent">${html}</body></html>`;
}

/** Re-runs the frame's __seek(t) without reloading it (preview only). */
export function seekFrame(iframe: HTMLIFrameElement | null, t: number): void {
  iframe?.contentWindow?.postMessage({ type: "klikreel:seek", t }, "*");
}
