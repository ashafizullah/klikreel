// Text clips render as plain HTML so preview and export share one markup.
import type { TextStyle } from "../types/project";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function textLayerHtml(text: string, s: TextStyle): string {
  const justify = s.align === "left" ? "flex-start" : s.align === "right" ? "flex-end" : "center";
  const boxed = s.background && s.background !== "transparent";
  const inner = [
    `font-family:${s.fontFamily}`,
    `font-size:${s.fontSize}px`,
    `font-weight:${s.fontWeight}`,
    `font-style:${s.italic ? "italic" : "normal"}`,
    `color:${s.color}`,
    `text-align:${s.align}`,
    `line-height:1.15`,
    `white-space:pre-wrap`,
    `max-width:88%`,
    boxed ? `background:${s.background};padding:0.18em 0.45em;border-radius:0.2em` : "",
    s.strokeWidth > 0 ? `-webkit-text-stroke:${s.strokeWidth}px ${s.strokeColor};paint-order:stroke fill` : "",
    s.shadow ? `text-shadow:0 4px 18px rgba(0,0,0,.55)` : "",
  ]
    .filter(Boolean)
    .join(";");
  return (
    `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:${justify};padding:0 5%">` +
    `<div style="${esc(inner).replace(/&#39;/g, "'")}">${esc(text)}</div></div>`
  );
}
