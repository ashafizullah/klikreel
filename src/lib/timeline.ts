// Pure timeline operations shared by the store, the UI and the AI agent.
import type { Asset, Clip, Project, Track } from "../types/project";
import { MIN_CLIP } from "./time";

export const clipEnd = (c: Clip) => c.start + c.duration;

export function projectDuration(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export function findClip(p: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** Media duration limit for a clip, or Infinity for images/HTML/text. */
export function sourceLength(clip: Clip, assets: Record<string, Asset>): number {
  if (clip.source.type !== "media") return Infinity;
  const a = assets[clip.source.assetId];
  return a && a.kind !== "image" && a.duration > 0 ? a.duration : Infinity;
}

export function overlaps(track: Track, start: number, duration: number, ignoreId?: string): boolean {
  const eps = 1e-6;
  return track.clips.some(
    (c) => c.id !== ignoreId && start < clipEnd(c) - eps && start + duration > c.start + eps,
  );
}

/** First start time ≥ `from` where a clip of `duration` fits on the track. */
export function firstFreeSlot(track: Track, from: number, duration: number, ignoreId?: string): number {
  let start = Math.max(0, from);
  const sorted = track.clips.filter((c) => c.id !== ignoreId).sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    if (start + duration <= c.start + 1e-6) break;
    if (start < clipEnd(c)) start = clipEnd(c);
  }
  return start;
}

export function splitClip(clip: Clip, at: number, newId: string): [Clip, Clip] | null {
  if (at <= clip.start + MIN_CLIP / 2 || at >= clipEnd(clip) - MIN_CLIP / 2) return null;
  const leftDur = at - clip.start;
  const left: Clip = { ...clip, duration: leftDur, fadeOut: 0 };
  const right: Clip = {
    ...clip,
    id: newId,
    start: at,
    duration: clip.duration - leftDur,
    trimIn: clip.trimIn + leftDur,
    fadeIn: 0,
  };
  return [left, right];
}

/** Moves the left edge to `newStart`, keeping the right edge fixed. */
export function trimLeft(clip: Clip, newStart: number, assets: Record<string, Asset>): Clip {
  const end = clipEnd(clip);
  const usesTrim = clip.source.type === "html" || sourceLength(clip, assets) !== Infinity;
  let start = Math.min(newStart, end - MIN_CLIP);
  start = Math.max(start, 0);
  if (usesTrim) start = Math.max(start, clip.start - clip.trimIn);
  const delta = start - clip.start;
  return {
    ...clip,
    start,
    duration: end - start,
    trimIn: usesTrim ? clip.trimIn + delta : 0,
  };
}

/** Moves the right edge to `newEnd`. */
export function trimRight(clip: Clip, newEnd: number, assets: Record<string, Asset>): Clip {
  const max = sourceLength(clip, assets) - clip.trimIn;
  const duration = Math.min(Math.max(newEnd - clip.start, MIN_CLIP), max);
  return { ...clip, duration };
}

export interface SnapResult {
  value: number;
  /** Time of the guide line when snapped. */
  guide: number | null;
}

/** Snaps any of `edges` (offsets relative to `value`) to the nearest candidate within `threshold`. */
export function snap(value: number, edges: number[], candidates: number[], threshold: number): SnapResult {
  let best: SnapResult = { value, guide: null };
  let bestDist = threshold;
  for (const edge of edges) {
    for (const c of candidates) {
      const d = Math.abs(value + edge - c);
      if (d < bestDist) {
        bestDist = d;
        best = { value: c - edge, guide: c };
      }
    }
  }
  return best;
}

export function snapCandidates(p: Project, playhead: number, ignoreId?: string): number[] {
  const out = [0, playhead];
  for (const t of p.tracks)
    for (const c of t.clips) if (c.id !== ignoreId) out.push(c.start, clipEnd(c));
  return out;
}

/** 0..1 multiplier from the clip's fade-in/out at local time `lt`. */
export function fadeFactor(clip: Pick<Clip, "duration" | "fadeIn" | "fadeOut">, lt: number): number {
  let f = 1;
  if (clip.fadeIn > 0) f = Math.min(f, lt / clip.fadeIn);
  if (clip.fadeOut > 0) f = Math.min(f, (clip.duration - lt) / clip.fadeOut);
  return Math.max(0, Math.min(1, f));
}

export function activeClip(track: Track, t: number): Clip | undefined {
  return track.clips.find((c) => t >= c.start && t < clipEnd(c));
}
