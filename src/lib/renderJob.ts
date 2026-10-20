// Converts the project into the job the Rust renderer executes.
import type { Project } from "../types/project";
import { buildComposition } from "./composition";
import { projectDuration } from "./timeline";

export interface RenderOptions {
  output: string;
  crf: number;
  preset: string;
  /** 4:4:4 chroma: crisp color edges, limited player support. */
  fullColor: boolean;
}

export function buildRenderJob(p: Project, opts: RenderOptions) {
  const media: unknown[] = [];
  const audio: unknown[] = [];
  // Bottom-most video track first so upper tracks overlay it.
  for (const track of [...p.tracks].reverse()) {
    for (const c of track.clips) {
      if (c.source.type !== "media") continue;
      const a = p.assets[c.source.assetId];
      if (!a) continue;
      if (track.kind === "video" && !track.hidden && (a.kind === "video" || a.kind === "image")) {
        media.push({
          path: a.path,
          kind: a.kind,
          start: c.start,
          duration: c.duration,
          trimIn: c.trimIn,
          naturalWidth: a.width,
          naturalHeight: a.height,
          ...c.transform,
          fadeIn: c.fadeIn,
          fadeOut: c.fadeOut,
        });
      }
      const audible = (a.kind === "audio" || (a.kind === "video" && a.hasAudio)) && !track.muted && c.volume > 0;
      if (audible) {
        audio.push({
          path: a.path,
          start: c.start,
          duration: c.duration,
          trimIn: c.trimIn,
          volume: c.volume,
          fadeIn: c.fadeIn,
          fadeOut: c.fadeOut,
        });
      }
    }
  }
  const comp = buildComposition(p);
  return {
    width: p.width,
    height: p.height,
    fps: p.fps,
    duration: projectDuration(p),
    output: opts.output,
    crf: opts.crf,
    preset: opts.preset,
    fullColor: opts.fullColor,
    background: p.background,
    compositionHtml: comp?.html ?? null,
    overlayRanges: comp?.ranges ?? [],
    media,
    audio,
  };
}
