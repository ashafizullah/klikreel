import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import type { Asset, Clip, Project, Track } from "../../types/project";
import { useProject } from "../../store/project";
import { claimClock, isClockMaster, releaseClock, usePlayback } from "../../store/playback";
import { buildFrameDoc, seekFrame } from "../../lib/frameRuntime";
import { resolveAssets, useImages } from "../../store/images";
import { textLayerHtml } from "../../lib/textLayer";
import { transformCss } from "../../lib/composition";
import { clipEnd, fadeFactor, findClip, projectDuration } from "../../lib/timeline";
import { fileUrl, useBlobUrl } from "../../lib/media";
import { formatTime } from "../../lib/time";
import { IconButton } from "../ui";
import { useT } from "../../i18n";

/** Frames and media this close to the playhead stay mounted so they are warm when reached. */
const PRELOAD = 2;

export function Preview() {
  const project = useProject((s) => s.project);
  const selectedId = useProject((s) => s.selectedClipId);
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });

  useEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min((box.w - 24) / project.width, (box.h - 24) / project.height);
  const tracks = [...project.tracks].reverse(); // bottom-most first

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg">
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className="grain-free shrink-0 overflow-hidden shadow-[0_0_0_1px_#2e2a22,0_18px_50px_-10px_rgba(0,0,0,0.75)]"
          style={{ width: project.width * scale, height: project.height * scale }}
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: project.width, height: project.height, transform: `scale(${scale})`, background: project.background }}
          >
            {tracks.map((track) => (
              <TrackLayers key={track.id} track={track} project={project} time={time} playing={playing} />
            ))}
          </div>
          <MoveHandle project={project} selectedId={selectedId} time={time} scale={scale} />
        </div>
      </div>
      <Transport project={project} time={time} playing={playing} />
    </div>
  );
}

function TrackLayers({ track, project, time, playing }: { track: Track; project: Project; time: number; playing: boolean }) {
  if (track.hidden && track.kind !== "audio") return null;
  return (
    <>
      {track.clips.map((clip) => {
        const active = time >= clip.start && time < clipEnd(clip);
        const lt = time - clip.start;
        if (clip.source.type === "html") {
          const near = time >= clip.start - PRELOAD && time < clipEnd(clip) + 0.25;
          return near ? <HtmlLayer key={clip.id} clip={clip} project={project} visible={active} localTime={Math.max(0, lt) + clip.trimIn} opacity={clip.transform.opacity * fadeFactor(clip, lt)} /> : null;
        }
        if (clip.source.type === "text" && !active) return null;
        // Media mounts early so the file is loaded when its clip starts.
        if (!(time >= clip.start - PRELOAD && time < clipEnd(clip))) return null;
        const opacity = clip.transform.opacity * fadeFactor(clip, lt);
        if (clip.source.type === "text") {
          return (
            <div
              key={clip.id}
              className="absolute inset-0"
              style={{ transform: transformCss(clip.transform), opacity }}
              dangerouslySetInnerHTML={{ __html: textLayerHtml(clip.source.text, clip.source.style) }}
            />
          );
        }
        const asset = project.assets[clip.source.assetId];
        if (!asset) return null;
        return (
          <MediaLayer
            key={clip.id}
            clip={clip}
            asset={asset}
            mediaTime={Math.max(0, lt) + clip.trimIn}
            active={active}
            playing={playing}
            muted={track.muted}
            visible={track.kind === "video"}
            opacity={opacity}
          />
        );
      })}
    </>
  );
}

/** Drift a non-master media element may have before it is re-seeked. */
const MAX_DRIFT = 0.5;
/** Minimum time between drift corrections, so seeks never pile up. */
const RESYNC_EVERY = 2000;

function MediaLayer({ clip, asset, mediaTime, active, playing, muted, visible, opacity }: {
  clip: Clip; asset: Asset; mediaTime: number; active: boolean; playing: boolean; muted: boolean; visible: boolean; opacity: number;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const assetSrc = useMemo(() => fileUrl(asset.path), [asset.path]);
  const audioSrc = useBlobUrl(asset.path);
  const src = asset.kind === "image" ? assetSrc : audioSrc;
  const starting = useRef(false);
  const lastSync = useRef(0);

  // Leave the master clock when this layer goes away.
  useEffect(() => () => releaseClock(clip.id), [clip.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing && active) {
      if (el.paused) {
        if (starting.current) return; // play() already requested
        el.currentTime = mediaTime;
        starting.current = true;
        el.play().catch(() => {}).finally(() => (starting.current = false));
        lastSync.current = performance.now();
        return;
      }
      const ready = !el.seeking && el.readyState >= 3;
      if (!ready) return;
      // The playing element drives the timeline; it is never seeked itself.
      claimClock(clip.id, () => (el.paused || el.seeking ? null : clip.start + el.currentTime - clip.trimIn));
      if (isClockMaster(clip.id)) return;
      const now = performance.now();
      if (now - lastSync.current > RESYNC_EVERY && Math.abs(el.currentTime - mediaTime) > MAX_DRIFT) {
        el.currentTime = mediaTime;
        lastSync.current = now;
      }
    } else {
      releaseClock(clip.id);
      if (!el.paused) el.pause();
      // Park on the frame to show (or the first frame while preloading).
      if (!el.seeking && Math.abs(el.currentTime - mediaTime) > 0.04) el.currentTime = mediaTime;
    }
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted;
    el.volume = Math.max(0, Math.min(1, clip.volume));
  }, [muted, clip.volume]);

  const style = { transform: transformCss(clip.transform), opacity: active ? opacity : 0 };
  if (asset.kind === "image") {
    return <img src={src} className="absolute inset-0 h-full w-full object-contain" style={style} draggable={false} />;
  }
  if (!src) return null;
  if (asset.kind === "audio" || !visible) {
    return <audio ref={ref} src={src} preload="auto" />;
  }
  return <video ref={ref} src={src} preload="auto" playsInline className="absolute inset-0 h-full w-full object-contain" style={style} />;
}

function HtmlLayer({ clip, project, visible, localTime, opacity }: {
  clip: Clip; project: Project; visible: boolean; localTime: number; opacity: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const src = clip.source as Extract<Clip["source"], { type: "html" }>;
  const images = useImages((s) => s.images);
  const doc = useMemo(() => buildFrameDoc(src.html, src.params, resolveAssets(src.assetRefs, images)), [src.html, src.params, src.assetRefs, images]);
  const timeRef = useRef(localTime);
  timeRef.current = localTime;

  useEffect(() => {
    if (visible) seekFrame(ref.current, localTime);
  }, [localTime, visible, doc]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      if (e.data?.type === "aive:ready") seekFrame(ref.current, timeRef.current);
      if (e.data?.type === "aive:error") console.warn(`[HTML Frame ${clip.name}]`, e.data.message);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [clip.name]);

  return (
    <iframe
      ref={ref}
      title={clip.name}
      sandbox="allow-scripts"
      srcDoc={doc}
      className="pointer-events-none absolute top-0 left-0 border-0"
      style={{
        width: project.width,
        height: project.height,
        transform: transformCss(clip.transform),
        opacity: visible ? opacity : 0,
        background: "transparent",
        colorScheme: "normal",
      }}
    />
  );
}

/** Drag on the canvas to reposition the selected clip. */
function MoveHandle({ project, selectedId, time, scale }: { project: Project; selectedId: string | null; time: number; scale: number }) {
  const t = useT();
  const hit = selectedId ? findClip(project, selectedId) : null;
  const active = hit && hit.track.kind !== "audio" && time >= hit.clip.start && time < clipEnd(hit.clip);
  if (!active || !hit) return null;
  const { clip } = hit;

  const onPointerDown = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const { x, y } = clip.transform;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const nx = Math.round(x + (ev.clientX - startX) / scale);
      const ny = Math.round(y + (ev.clientY - startY) / scale);
      useProject.getState().updateClip(clip.id, { transform: { ...clip.transform, x: nx, y: ny } });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  let rect = { left: 0, top: 0, width: project.width, height: project.height };
  if (clip.source.type === "media") {
    const a = project.assets[clip.source.assetId];
    if (a && a.width && a.height) {
      const fit = Math.min(project.width / a.width, project.height / a.height) * clip.transform.scale;
      const w = a.width * fit;
      const h = a.height * fit;
      rect = { left: (project.width - w) / 2 + clip.transform.x, top: (project.height - h) / 2 + clip.transform.y, width: w, height: h };
    }
  }
  return (
    <div className="absolute inset-0 cursor-move" onPointerDown={onPointerDown} title={t("preview.dragToMove")}>
      {clip.source.type === "media" && (
        <div
          className="pointer-events-none absolute border border-accent"
          style={{ left: rect.left * scale, top: rect.top * scale, width: rect.width * scale, height: rect.height * scale }}
        />
      )}
    </div>
  );
}

function Transport({ project, time, playing }: { project: Project; time: number; playing: boolean }) {
  const t = useT();
  const { toggle, seek } = usePlayback.getState();
  const duration = projectDuration(project);
  const frame = 1 / project.fps;
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-t border-line bg-panel px-3">
      <div className="w-48 font-mono text-[12px] whitespace-nowrap text-muted tabular-nums">
        <span className="text-accent">{formatTime(time)}</span> / {formatTime(duration)}
      </div>
      <div className="flex items-center gap-1">
        <IconButton title={t("preview.toStart")} onClick={() => seek(0)}><SkipBack size={15} /></IconButton>
        <IconButton title={t("preview.prevFrame")} onClick={() => seek(time - frame)}><StepBack size={15} /></IconButton>
        <button
          className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-110"
          title={t("preview.playPause")}
          onClick={toggle}
        >
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
        <IconButton title={t("preview.nextFrame")} onClick={() => seek(time + frame)}><StepForward size={15} /></IconButton>
        <IconButton title={t("preview.toEnd")} onClick={() => seek(duration)}><SkipForward size={15} /></IconButton>
      </div>
      <div className="w-48 text-right text-[11px] text-muted">
        {project.width}×{project.height} · {project.fps} fps
      </div>
    </div>
  );
}
