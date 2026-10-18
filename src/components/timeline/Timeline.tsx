import { useEffect, useRef } from "react";
import { create, useStore } from "zustand";
import { AudioLines, Eye, EyeOff, Film, Lock, Magnet, Redo2, Trash2, Type, Undo2, Unlock, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import type { Track } from "../../types/project";
import { redo, undo, useProject } from "../../store/project";
import { usePlayback } from "../../store/playback";
import { useUi } from "../../store/ui";
import { projectDuration } from "../../lib/timeline";
import { formatTime } from "../../lib/time";
import { IconButton } from "../ui";
import { useT } from "../../i18n";
import { TimelineClip } from "./TimelineClip";
import { ClipMenu } from "./ClipMenu";

export const HEADER_W = 148;
export const RULER_H = 28;
export const TRACK_H: Record<Track["kind"], number> = { video: 64, overlay: 56, audio: 40 };

/** Snap guide shared between clips and the timeline body. */
export const useGuide = create<{ x: number | null; set(x: number | null): void }>()((set) => ({ x: null, set: (x) => set({ x }) }));

export function Timeline() {
  const t = useT();
  const project = useProject((s) => s.project);
  const selectedId = useProject((s) => s.selectedClipId);
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const { zoom, setZoom, snapping, toggleSnapping } = useUi();
  const guide = useGuide((s) => s.x);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canUndo = useStore(useProject.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProject.temporal, (s) => s.futureStates.length > 0);

  const duration = projectDuration(project);
  const contentW = Math.max((duration + 20) * zoom, 4000);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = time * zoom;
    const visibleW = el.clientWidth - HEADER_W;
    if (x < el.scrollLeft || x > el.scrollLeft + visibleW - 40) el.scrollLeft = Math.max(0, x - 40);
  }, [time, zoom, playing]);

  // Cmd/Ctrl + wheel zooms around the cursor.
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left - HEADER_W + el.scrollLeft;
      const t = cursorX / useUi.getState().zoom;
      const next = useUi.getState().zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
      useUi.getState().setZoom(next);
      const z = useUi.getState().zoom;
      el.scrollLeft = t * z - (e.clientX - rect.left - HEADER_W);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const xToTime = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEADER_W + el.scrollLeft) / zoom);
  };

  const scrub = (e: React.PointerEvent) => {
    const { seek, pause } = usePlayback.getState();
    pause();
    seek(xToTime(e.clientX));
    const move = (ev: PointerEvent) => seek(xToTime(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex h-full flex-col border-t border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <IconButton title={t("timeline.undo")} disabled={!canUndo} onClick={undo}><Undo2 size={15} /></IconButton>
        <IconButton title={t("timeline.redo")} disabled={!canRedo} onClick={redo}><Redo2 size={15} /></IconButton>
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton title={t("timeline.delete")} disabled={!selectedId} onClick={() => selectedId && useProject.getState().removeClip(selectedId)}><Trash2 size={15} /></IconButton>
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton title={t("timeline.snap")} active={snapping} onClick={toggleSnapping}><Magnet size={15} /></IconButton>
        <div className="flex-1" />
        <span className="mr-2 font-mono text-[11px] text-muted tabular-nums">{formatTime(time)}</span>
        <IconButton title={t("timeline.zoomOut")} onClick={() => setZoom(zoom / 1.3)}><ZoomOut size={15} /></IconButton>
        <input type="range" min={4} max={600} value={zoom} title={t("timeline.zoom")} onChange={(e) => setZoom(+e.target.value)} className="w-28 accent-[var(--color-accent)]" />
        <IconButton title={t("timeline.zoomIn")} onClick={() => setZoom(zoom * 1.3)}><ZoomIn size={15} /></IconButton>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: contentW + HEADER_W, minHeight: "100%" }}>
          {/* Ruler */}
          <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-30 shrink-0 border-r border-b border-line bg-panel" style={{ width: HEADER_W }} />
            <Ruler width={contentW} zoom={zoom} onPointerDown={scrub} />
          </div>

          {project.tracks.map((track) => (
            <div key={track.id} className="flex border-b border-line/70" style={{ height: TRACK_H[track.kind] }}>
              <TrackHeader track={track} />
              <div
                data-track-id={track.id}
                className={`relative shrink-0 ${track.kind === "video" ? "bg-[#15171a]" : "bg-[#131416]"}`}
                style={{ width: contentW }}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  useProject.getState().select(null);
                  scrub(e);
                }}
              >
                {track.clips.map((clip) => (
                  <TimelineClip key={clip.id} clip={clip} track={track} selected={clip.id === selectedId} zoom={zoom} height={TRACK_H[track.kind]} />
                ))}
              </div>
            </div>
          ))}

          {/* Playhead */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-20" style={{ left: HEADER_W + time * zoom }}>
            <div className="absolute top-0 bottom-0 w-px -translate-x-1/2 bg-white" />
            <div className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-b-sm bg-white" />
          </div>
          <ClipMenu />
          {guide !== null && (
            <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent" style={{ left: HEADER_W + guide * zoom }} />
          )}
        </div>
      </div>
    </div>
  );
}

function TrackHeader({ track }: { track: Track }) {
  const t = useT();
  const { updateTrack, removeTrack } = useProject.getState();
  const Icon = track.kind === "video" ? Film : track.kind === "audio" ? AudioLines : Type;
  return (
    <div className="group sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line bg-panel px-2" style={{ width: HEADER_W }}>
      <Icon size={13} className="shrink-0 text-muted" />
      <input
        className="min-w-0 flex-1 truncate bg-transparent text-[11px] outline-none"
        value={track.role ? t(`track.${track.role}`) : track.name}
        readOnly={!!track.role}
        onChange={(e) => updateTrack(track.id, { name: e.target.value })}
      />
      {track.kind === "audio" || track.kind === "video" ? (
        <button className="text-muted hover:text-text" title={t(track.muted ? "timeline.unmute" : "timeline.mute")} onClick={() => updateTrack(track.id, { muted: !track.muted })}>
          {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
      ) : null}
      {track.kind !== "audio" && (
        <button className="text-muted hover:text-text" title={t(track.hidden ? "timeline.show" : "timeline.hide")} onClick={() => updateTrack(track.id, { hidden: !track.hidden })}>
          {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      )}
      <button className="text-muted hover:text-text" title={t(track.locked ? "timeline.unlock" : "timeline.lock")} onClick={() => updateTrack(track.id, { locked: !track.locked })}>
        {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
      {track.clips.length === 0 && !track.role && (
        <button className="hidden text-muted group-hover:block hover:text-danger" title={t("timeline.removeTrack")} onClick={() => removeTrack(track.id)}>
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function Ruler({ width, zoom, onPointerDown }: { width: number; zoom: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const step = STEPS.find((s) => s * zoom >= 80) ?? 600;
  const minor = step / 5;
  const ticks: React.ReactNode[] = [];
  const total = width / zoom;
  for (let i = 0; i * minor <= total; i++) {
    const t = i * minor;
    const major = i % 5 === 0;
    ticks.push(
      <div key={i} className="absolute bottom-0" style={{ left: t * zoom }}>
        <div className={`w-px ${major ? "h-2.5 bg-muted" : "h-1.5 bg-line"}`} />
        {major && <span className="absolute bottom-3 left-1 font-mono text-[10px] whitespace-nowrap text-muted">{formatTime(t, step < 1)}</span>}
      </div>,
    );
  }
  return (
    <div className="relative shrink-0 cursor-pointer border-b border-line bg-panel" style={{ width }} onPointerDown={onPointerDown}>
      {ticks}
    </div>
  );
}
