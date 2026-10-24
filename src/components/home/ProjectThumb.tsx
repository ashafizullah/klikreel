// Project card preview: the first generated scene, paused on a frame where
// its entrance has finished, scaled to cover the card.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectMeta } from "../../lib/ipc";
import { buildFrameDoc, seekFrame } from "../../lib/frameRuntime";

/** A moment after the entrance (~0.8 s) and before the exit (last 0.4 s). */
export function thumbTime(duration: number): number {
  return Math.max(0, Math.min(duration - 0.5, Math.max(1.2, duration * 0.45)));
}

export function ProjectThumb({ project }: { project: ProjectMeta }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [visible, setVisible] = useState(false);
  const thumb = project.thumb;
  const doc = useMemo(() => (thumb ? buildFrameDoc(thumb.html, {}, thumb.assets) : ""), [thumb]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    // Only load scenes that scroll into view; each one runs its own page.
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px" });
    ro.observe(el);
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!thumb || !visible) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && e.data?.type === "klikreel:ready") seekFrame(frame.current, thumbTime(thumb.duration));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [thumb, visible]);

  const { width, height } = project;
  const scale = width && height ? Math.max(size.w / width, size.h / height) : 0;
  return (
    <div ref={box} className="relative h-28 overflow-hidden bg-gradient-to-br from-[#221e18] to-[#0e0c09]">
      {thumb && visible && scale > 0 ? (
        <iframe
          ref={frame}
          title={project.name}
          srcDoc={doc}
          sandbox="allow-scripts"
          tabIndex={-1}
          className="pointer-events-none absolute top-1/2 left-1/2 origin-center border-0 bg-transparent"
          style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <div
            className="rounded border border-white/30"
            style={{ width: (width / Math.max(width, height, 1)) * 64, height: (height / Math.max(width, height, 1)) * 64 }}
          />
        </div>
      )}
    </div>
  );
}
