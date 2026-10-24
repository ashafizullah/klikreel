import { useState } from "react";
import { Sparkles, Type } from "lucide-react";
import type { Asset, Clip, Track } from "../../types/project";
import { useProject } from "../../store/project";
import { usePlayback } from "../../store/playback";
import { useMediaCache } from "../../store/media";
import { useUi } from "../../store/ui";
import { clipEnd, snap, snapCandidates, trimLeft, trimRight } from "../../lib/timeline";
import { fileUrl } from "../../lib/media";
import { useGuide } from "./Timeline";
import { useClipMenu } from "./ClipMenu";
import { useProduction } from "../../store/production";
import { reviseSceneDuration } from "../../lib/producer";
import { t as tr, useT } from "../../i18n";

const SNAP_PX = 8;

type Drag =
  | { mode: "move"; dx: number; dy: number; start: number; trackId: string }
  | { mode: "trim"; clip: Clip };

export function TimelineClip({ clip, track, selected, zoom, height }: { clip: Clip; track: Track; selected: boolean; zoom: number; height: number }) {
  const t = useT();
  const [drag, setDrag] = useState<Drag | null>(null);
  const assets = useProject((s) => s.project.assets);
  const asset = clip.source.type === "media" ? assets[clip.source.assetId] : undefined;

  const view = drag?.mode === "trim" ? drag.clip : clip;
  const left = (drag?.mode === "move" ? drag.start : view.start) * zoom;
  const width = Math.max(4, view.duration * zoom);

  const begin = (e: React.PointerEvent, kind: "move" | "left" | "right") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useProject.getState().select(clip.id);
    if (track.locked) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const { project } = useProject.getState();
    const snapOn = useUi.getState().snapping;
    const candidates = snapOn ? snapCandidates(project, usePlayback.getState().time, clip.id) : [];
    const threshold = SNAP_PX / zoom;
    const guide = useGuide.getState().set;
    let latest: Drag | null = null;
    let moved = false;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - startY) < 3) return;
      moved = true;
      const dt = dx / zoom;
      if (kind === "move") {
        const r = snap(Math.max(0, clip.start + dt), [0, clip.duration], candidates, threshold);
        const lane = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => (el as HTMLElement).dataset?.trackId) as HTMLElement | undefined;
        latest = { mode: "move", dx, dy: ev.clientY - startY, start: Math.max(0, r.value), trackId: lane?.dataset.trackId ?? track.id };
        guide(r.guide);
      } else {
        const edge = kind === "left" ? clip.start + dt : clipEnd(clip) + dt;
        const r = snap(edge, [0], candidates, threshold);
        const next = kind === "left" ? trimLeft(clip, r.value, project.assets) : trimRight(clip, r.value, project.assets);
        latest = { mode: "trim", clip: next };
        guide(r.guide);
      }
      setDrag(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      guide(null);
      setDrag(null);
      const d = latest as Drag | null;
      if (!d) return;
      const store = useProject.getState();
      if (d.mode === "move") {
        if (!store.moveClip(clip.id, d.start, d.trackId)) useUi.getState().notify(tr("timeline.moveBlocked"));
      } else if (clip.sceneId && track.role === "scenes") {
        // Resizing a scene: the AI retimes it to the new length.
        const sceneId = clip.sceneId;
        const duration = d.clip.duration;
        useProduction.getState().sceneJob(sceneId, "scenes.revisingLabel", () => reviseSceneDuration(sceneId, duration));
      } else {
        store.updateClip(clip.id, { start: d.clip.start, duration: d.clip.duration, trimIn: d.clip.trimIn });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const color =
    clip.source.type === "html"
      ? "bg-clip-scene border-clip-scene-edge"
      : clip.source.type === "text"
        ? "bg-clip-text border-clip-text-edge"
        : track.kind === "audio"
          ? "bg-clip-audio border-clip-audio-edge"
          : "bg-clip-media border-clip-media-edge";

  return (
    <div
      className={`absolute top-1 bottom-1 overflow-hidden rounded-md border ${color} ${selected ? "ring-2 ring-text ring-offset-1 ring-offset-bg" : ""} ${drag?.mode === "move" ? "z-30 opacity-80 shadow-xl" : ""} ${track.locked ? "cursor-not-allowed" : "cursor-grab"}`}
      style={{ left, width, transform: drag?.mode === "move" ? `translateY(${drag.dy}px)` : undefined }}
      onPointerDown={(e) => begin(e, "move")}
      onDoubleClick={() => clip.source.type === "html" && useUi.getState().open("code")}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        useProject.getState().select(clip.id);
        useClipMenu.getState().show(e.clientX, e.clientY, clip.id);
      }}
      title={clip.sceneId ? t("timeline.dragScene") : undefined}
    >
      {asset && asset.kind !== "audio" && <Thumbs clip={view} asset={asset} width={width} height={height - 8} zoom={zoom} />}
      {asset && (asset.kind === "audio" || asset.hasAudio) && (
        <Wave clip={view} asset={asset} width={width} height={track.kind === "audio" ? height - 22 : 16} zoom={zoom} />
      )}
      <div className="pointer-events-none absolute top-0 left-0 flex max-w-full items-center gap-1 truncate rounded-br bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {clip.source.type === "html" && <Sparkles size={10} />}
        {clip.source.type === "text" && <Type size={10} />}
        <span className="truncate">{clip.source.type === "text" ? clip.source.text : clip.name}</span>
      </div>
      {!track.locked && track.role !== "voice" && track.role !== "music" && (
        <>
          <div className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/60" onPointerDown={(e) => begin(e, "left")} />
          <div className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/60" onPointerDown={(e) => begin(e, "right")} />
        </>
      )}
    </div>
  );
}

function Thumbs({ clip, asset, width, height, zoom }: { clip: Clip; asset: Asset; width: number; height: number; zoom: number }) {
  const thumbs = useMediaCache((s) => s.thumbs[asset.id]);
  if (!thumbs?.length) return null;
  const aspect = asset.width && asset.height ? asset.width / asset.height : 16 / 9;
  const tileW = Math.max(24, height * aspect);
  const tiles = Math.ceil(width / tileW);
  const out = [];
  for (let k = 0; k < Math.min(tiles, 200); k++) {
    let idx = 0;
    if (asset.kind === "video" && asset.duration > 0) {
      const t = clip.trimIn + (k * tileW + tileW / 2) / zoom;
      idx = Math.min(thumbs.length - 1, Math.max(0, Math.floor((t / asset.duration) * thumbs.length)));
    }
    out.push(
      <img key={k} src={fileUrl(thumbs[idx])} draggable={false} className="absolute top-0 h-full object-cover opacity-80" style={{ left: k * tileW, width: tileW }} />,
    );
  }
  return <div className="pointer-events-none absolute inset-0">{out}</div>;
}

function Wave({ clip, asset, width, height, zoom }: { clip: Clip; asset: Asset; width: number; height: number; zoom: number }) {
  const peaks = useMediaCache((s) => s.peaks[asset.id]);
  if (!peaks?.length || asset.duration <= 0) return null;
  const step = 2;
  let d = "";
  for (let x = 0; x < Math.min(width, 20000); x += step) {
    const t = clip.trimIn + x / zoom;
    const p = peaks[Math.min(peaks.length - 1, Math.floor((t / asset.duration) * peaks.length))] ?? 0;
    const h = Math.max(1, p * height * clip.volume);
    d += `M${x} ${height - h}V${height}`;
  }
  return (
    <svg className="pointer-events-none absolute bottom-0 left-0" width={width} height={height}>
      <path d={d} stroke="rgba(237,230,216,0.55)" strokeWidth={1.2} />
    </svg>
  );
}
