import { create } from "zustand";
import { temporal } from "zundo";
import type { Asset, Clip, ClipSource, Project, Scene, Track, TrackKind } from "../types/project";
import { DEFAULT_BRIEF, DEFAULT_TRANSFORM, trackAccepts } from "../types/project";
import { newId } from "../lib/ids";
import { findClip, firstFreeSlot, overlaps, splitClip } from "../lib/timeline";
import { moveSceneTo, relayout } from "../lib/scenes";

export function emptyProject(over: Partial<Project> = {}): Project {
  return {
    version: 1,
    id: newId("prj"),
    name: "Untitled Project",
    workspaceId: null,
    brief: { ...DEFAULT_BRIEF },
    style: null,
    scenes: [],
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#000000",
    assets: {},
    tracks: [
      { id: newId("trk"), kind: "overlay", name: "Overlay", muted: false, hidden: false, locked: false, clips: [] },
      { id: newId("trk"), kind: "video", name: "Video", muted: false, hidden: false, locked: false, clips: [] },
      { id: newId("trk"), kind: "audio", name: "Audio", muted: false, hidden: false, locked: false, clips: [] },
    ],
    ...over,
  };
}

/** Fills fields added after a project file was written. */
export function normalizeProject(p: Project): Project {
  return { ...emptyProject(), ...p, brief: { ...DEFAULT_BRIEF, ...(p.brief ?? {}) }, scenes: p.scenes ?? [], style: p.style ?? null };
}

const TRACK_NAMES: Record<TrackKind, string> = { overlay: "Overlay", video: "Video", audio: "Audio" };

export interface NewClip {
  source: ClipSource;
  start: number;
  duration: number;
  name?: string;
  trimIn?: number;
  trackId?: string;
}

interface ProjectState {
  project: Project;
  filePath: string | null;
  dirty: boolean;
  selectedClipId: string | null;

  load(project: Project, filePath: string | null): void;
  markSaved(filePath: string): void;
  update(fn: (p: Project) => void): void;
  select(clipId: string | null): void;

  addAsset(asset: Asset): void;
  addTrack(kind: TrackKind): string;
  updateTrack(trackId: string, patch: Partial<Track>): void;
  removeTrack(trackId: string): void;
  /** Places a clip on the given or first compatible track, creating one if needed. Returns the clip id. */
  addClip(c: NewClip): string;
  updateClip(clipId: string, patch: Partial<Clip>): void;
  /** Moves a clip; returns false when the target slot is occupied or incompatible. */
  moveClip(clipId: string, start: number, trackId?: string): boolean;
  splitAt(clipId: string, at: number): string | null;
  removeClip(clipId: string): void;

  /** Replaces the storyboard and rebuilds the managed tracks. */
  setScenes(scenes: Scene[]): void;
  updateScene(sceneId: string, patch: Partial<Scene>): void;
  moveScene(sceneId: string, toIndex: number): void;
  removeScene(sceneId: string): void;
}

/**
 * Undo history ignores transient job status ("pending"/"generating"), so an
 * AI edit is one undo step and undoing never leaves a scene stuck spinning.
 */
export function historySnapshot(p: Project): Project {
  if (!p.scenes.some((s) => s.status === "pending" || s.status === "generating")) return p;
  return {
    ...p,
    scenes: p.scenes.map((s) =>
      s.status === "pending" || s.status === "generating" ? { ...s, status: s.html ? "ready" : "error", error: undefined } : s,
    ),
  };
}

/** Mutating helper: zustand state stays immutable via structuredClone. */
function produce(p: Project, fn: (draft: Project) => void): Project {
  const draft = structuredClone(p);
  fn(draft);
  return draft;
}

export const useProject = create<ProjectState>()(
  temporal(
    (set, get) => ({
      project: emptyProject(),
      filePath: null,
      dirty: false,
      selectedClipId: null,

      load: (project, filePath) => set({ project, filePath, dirty: false, selectedClipId: null }),
      markSaved: (filePath) => set({ filePath, dirty: false }),
      update: (fn) => set((s) => ({ project: produce(s.project, fn), dirty: true })),
      select: (selectedClipId) => set({ selectedClipId }),

      addAsset: (asset) => get().update((p) => void (p.assets[asset.id] = asset)),

      addTrack: (kind) => {
        const id = newId("trk");
        get().update((p) => {
          const track: Track = { id, kind, name: TRACK_NAMES[kind], muted: false, hidden: false, locked: false, clips: [] };
          // Overlays go on top, audio at the bottom, video above the first video track.
          if (kind === "overlay") p.tracks.unshift(track);
          else if (kind === "audio") p.tracks.push(track);
          else {
            const i = p.tracks.findIndex((t) => t.kind === "video");
            p.tracks.splice(i < 0 ? p.tracks.length : i, 0, track);
          }
        });
        return id;
      },

      updateTrack: (trackId, patch) =>
        get().update((p) => {
          const t = p.tracks.find((t) => t.id === trackId);
          if (t) Object.assign(t, patch);
        }),

      removeTrack: (trackId) =>
        get().update((p) => {
          p.tracks = p.tracks.filter((t) => t.id !== trackId);
        }),

      addClip: (c) => {
        const id = newId("clp");
        const { project } = get();
        let trackId = c.trackId;
        const fits = (t: Track) =>
          trackAccepts(t.kind, c.source, project.assets) && !t.locked && !overlaps(t, c.start, c.duration);
        if (!trackId || !project.tracks.find((t) => t.id === trackId && fits(t))) {
          trackId = project.tracks.find(fits)?.id;
        }
        if (!trackId) {
          const kind: TrackKind =
            c.source.type === "media" ? (project.assets[c.source.assetId]?.kind === "audio" ? "audio" : "video") : "overlay";
          trackId = get().addTrack(kind);
        }
        const clip: Clip = {
          id,
          name: c.name ?? "Klip",
          start: Math.max(0, c.start),
          duration: c.duration,
          trimIn: c.trimIn ?? 0,
          source: c.source,
          transform: { ...DEFAULT_TRANSFORM },
          fadeIn: 0,
          fadeOut: 0,
          volume: 1,
        };
        get().update((p) => {
          const t = p.tracks.find((t) => t.id === trackId)!;
          clip.start = firstFreeSlot(t, clip.start, clip.duration);
          t.clips.push(clip);
        });
        set({ selectedClipId: id });
        return id;
      },

      updateClip: (clipId, patch) =>
        get().update((p) => {
          const hit = findClip(p, clipId);
          if (!hit) return;
          const scene = hit.clip.sceneId && p.scenes.find((x) => x.id === hit.clip.sceneId);
          if (!scene) return void Object.assign(hit.clip, patch);
          // Scene clips are derived: write through to the scene.
          if (hit.track.role === "scenes") {
            if (patch.duration !== undefined) {
              if (scene.html && !scene.designDuration) scene.designDuration = scene.duration;
              scene.duration = Math.max(0.5, patch.duration);
            }
            if (patch.source?.type === "html") scene.html = patch.source.html;
          }
          relayout(p);
        }),

      moveClip: (clipId, start, trackId) => {
        const { project } = get();
        const hit = findClip(project, clipId);
        if (!hit) return false;
        if (hit.clip.sceneId) {
          get().update((p) => {
            moveSceneTo(p, hit.clip.sceneId!, hit.track.role === "voice" ? start - 0.3 : start);
            relayout(p);
          });
          return true;
        }
        const target = project.tracks.find((t) => t.id === (trackId ?? hit.track.id));
        if (!target || target.locked) return false;
        if (!trackAccepts(target.kind, hit.clip.source, project.assets)) return false;
        const s = Math.max(0, start);
        if (overlaps(target, s, hit.clip.duration, clipId)) return false;
        get().update((p) => {
          const from = p.tracks.find((t) => t.id === hit.track.id)!;
          const to = p.tracks.find((t) => t.id === target.id)!;
          const idx = from.clips.findIndex((c) => c.id === clipId);
          const [clip] = from.clips.splice(idx, 1);
          clip.start = s;
          to.clips.push(clip);
        });
        return true;
      },

      splitAt: (clipId, at) => {
        const hit = findClip(get().project, clipId);
        if (!hit || hit.clip.sceneId) return null;
        const rightId = newId("clp");
        const parts = splitClip(hit.clip, at, rightId);
        if (!parts) return null;
        get().update((p) => {
          const t = p.tracks.find((t) => t.id === hit.track.id)!;
          const i = t.clips.findIndex((c) => c.id === clipId);
          t.clips.splice(i, 1, parts[0], parts[1]);
        });
        return rightId;
      },

      removeClip: (clipId) => {
        const sceneId = findClip(get().project, clipId)?.clip.sceneId;
        if (sceneId) return get().removeScene(sceneId);
        get().update((p) => {
          for (const t of p.tracks) t.clips = t.clips.filter((c) => c.id !== clipId);
        });
        if (get().selectedClipId === clipId) set({ selectedClipId: null });
      },

      setScenes: (scenes) =>
        get().update((p) => {
          p.scenes = scenes;
          relayout(p);
        }),

      updateScene: (sceneId, patch) =>
        get().update((p) => {
          const scene = p.scenes.find((x) => x.id === sceneId);
          if (!scene) return;
          const lengthChanged = patch.duration !== undefined && patch.duration !== scene.duration;
          if (lengthChanged && scene.html && !scene.designDuration && patch.designDuration === undefined) scene.designDuration = scene.duration;
          Object.assign(scene, patch);
          relayout(p);
        }),

      moveScene: (sceneId, toIndex) =>
        get().update((p) => {
          const from = p.scenes.findIndex((x) => x.id === sceneId);
          if (from < 0) return;
          const [scene] = p.scenes.splice(from, 1);
          p.scenes.splice(Math.max(0, Math.min(p.scenes.length, toIndex)), 0, scene);
          relayout(p);
        }),

      removeScene: (sceneId) => {
        get().update((p) => {
          p.scenes = p.scenes.filter((x) => x.id !== sceneId);
          relayout(p);
        });
        set({ selectedClipId: null });
      },
    }),
    {
      limit: 150,
      partialize: (s) => ({ project: historySnapshot(s.project) }),
      // Every edit clones the project, so compare content (status changes alone are not a step).
      equality: (a, b) => a.project === b.project || JSON.stringify(a.project) === JSON.stringify(b.project),
      // Group rapid edits (slider drags, typing) into one undo step.
      handleSet: (handleSet) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let pending = false;
        return (...args: Parameters<typeof handleSet>) => {
          if (!pending) {
            handleSet(...args);
            pending = true;
          }
          clearTimeout(timer);
          timer = setTimeout(() => (pending = false), 400);
        };
      },
    },
  ),
);

export const undo = () => useProject.temporal.getState().undo();
export const redo = () => useProject.temporal.getState().redo();
