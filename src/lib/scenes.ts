// Storyboard scenes are the source of truth for the generated video. These
// pure helpers rebuild the scene, voiceover and music tracks from them.
import type { Clip, Project, Scene, Track, TrackRole } from "../types/project";
import { DEFAULT_TRANSFORM } from "../types/project";
import { t } from "../i18n";

/** Voiceover starts slightly after the scene so the visual leads. */
export const VOICE_LEAD = 0.3;
/** Silence kept after the narration before the next scene. */
export const VOICE_TAIL = 0.6;
export const MUSIC_ASSET_ID = "ast_music";

const voiceAssetId = (sceneId: string) => `ast_voice_${sceneId}`;

function placeholderHtml(scene: Scene, index: number): string {
  const label = t(scene.status === "error" ? "scenes.placeholderFailed" : "scenes.placeholderGenerating");
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return `<!doctype html><html><head><style>html,body{margin:0;width:100vw;height:100vh;background:#111318;color:#e8eaed;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2vh}
h1{margin:0;font-size:6vh}p{margin:0;font-size:2.6vh;color:#8a8f98}</style></head><body><p>${esc(t("scenes.number", { n: index + 1 }))}</p><h1>${esc(scene.title)}</h1><p>${label}</p></body></html>`;
}

function ensureTrack(p: Project, role: TrackRole): Track {
  let track = p.tracks.find((x) => x.role === role);
  if (track) return track;
  const base = { muted: false, hidden: false, locked: false, clips: [] as Clip[], role };
  if (role === "scenes") {
    track = { ...base, id: "trk_scenes", kind: "overlay", name: "Scenes" };
    // Lowest overlay layer: directly above the first video/audio track.
    const i = p.tracks.findIndex((x) => x.kind !== "overlay");
    p.tracks.splice(i < 0 ? p.tracks.length : i, 0, track);
  } else {
    track = { ...base, id: role === "voice" ? "trk_voice" : "trk_music", kind: "audio", name: role === "voice" ? "Voiceover" : "Music" };
    p.tracks.push(track);
  }
  return track;
}

export function sceneStarts(scenes: Scene[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const s of scenes) {
    starts.push(t);
    t += s.duration;
  }
  return starts;
}

export function totalDuration(scenes: Scene[]): number {
  return scenes.reduce((a, s) => a + s.duration, 0);
}

/** Scene length that exactly wraps its narration (may shrink the scene). */
export function exactFit(voiceDuration: number): number {
  return Math.max(1.5, Math.round((VOICE_LEAD + voiceDuration + VOICE_TAIL) * 10) / 10);
}

/** Whether a scene's animation timing no longer matches its length (or its unlocked length no longer fits the narration). */
export function needsSync(scene: Scene): boolean {
  if (!scene.html) return false;
  const designed = scene.designDuration ?? scene.duration;
  if (Math.abs(designed - scene.duration) > 0.05) return true;
  return !scene.durationLocked && voiceTooLong(scene);
}

/** The voiceover runs past the end of its scene (it is cut off there). */
export function voiceTooLong(scene: Scene): boolean {
  return !!scene.voiceDuration && VOICE_LEAD + scene.voiceDuration > scene.duration + 0.05;
}

/** Scene length that fits its narration. */
export function fitDuration(scene: Scene): number {
  if (!scene.voiceDuration) return scene.duration;
  return Math.max(scene.duration, exactFit(scene.voiceDuration));
}

/** Rebuilds the managed tracks from `p.scenes` (mutates the draft). */
export function relayout(p: Project): void {
  const scenesTrack = ensureTrack(p, "scenes");
  const starts = sceneStarts(p.scenes);
  scenesTrack.clips = p.scenes.map((s, i) => ({
    id: `clp_scene_${s.id}`,
    name: `${i + 1}. ${s.title}`,
    start: starts[i],
    duration: s.duration,
    trimIn: 0,
    source: {
      type: "html",
      html: s.html || placeholderHtml(s, i),
      params: {},
      prompt: s.visual,
      assetRefs: s.assetRefs,
    },
    transform: { ...DEFAULT_TRANSFORM },
    fadeIn: 0,
    fadeOut: 0,
    volume: 1,
    sceneId: s.id,
  }));

  // Voiceover clips follow their scene.
  for (const id of Object.keys(p.assets)) if (id.startsWith("ast_voice_")) delete p.assets[id];
  const voiced = p.scenes.some((s) => s.voicePath);
  if (voiced || p.tracks.some((t) => t.role === "voice")) {
    const voiceTrack = ensureTrack(p, "voice");
    voiceTrack.clips = [];
    p.scenes.forEach((s, i) => {
      if (!s.voicePath || !s.voiceDuration) return;
      const assetId = voiceAssetId(s.id);
      p.assets[assetId] = {
        id: assetId, path: s.voicePath, name: `voice-${i + 1}.mp3`, kind: "audio",
        duration: s.voiceDuration, width: 0, height: 0, fps: 0, hasAudio: true,
      };
      voiceTrack.clips.push({
        id: `clp_voice_${s.id}`,
        name: t("track.voiceClip", { n: i + 1 }),
        start: starts[i] + VOICE_LEAD,
        duration: Math.max(0.1, Math.min(s.voiceDuration, s.duration - VOICE_LEAD)),
        trimIn: 0,
        source: { type: "media", assetId },
        transform: { ...DEFAULT_TRANSFORM },
        fadeIn: 0,
        fadeOut: 0,
        volume: 1,
        sceneId: s.id,
      });
    });
  }

  // Background music spans the whole video.
  const music = p.assets[MUSIC_ASSET_ID];
  if (music && p.brief.musicPath) {
    const musicTrack = ensureTrack(p, "music");
    const total = totalDuration(p.scenes);
    const existing = musicTrack.clips[0];
    musicTrack.clips = total > 0
      ? [{
          id: "clp_music",
          name: music.name,
          start: 0,
          duration: Math.min(total, music.duration || total),
          trimIn: 0,
          source: { type: "media", assetId: MUSIC_ASSET_ID },
          transform: { ...DEFAULT_TRANSFORM },
          fadeIn: existing?.fadeIn ?? 0.5,
          fadeOut: existing?.fadeOut ?? 1.5,
          volume: p.brief.musicVolume,
        }]
      : [];
  } else {
    const t = p.tracks.find((x) => x.role === "music");
    if (t) t.clips = [];
  }
}

/** Moves a scene whose clip was dropped starting at `dropTime` (mutates the draft). */
export function moveSceneTo(p: Project, sceneId: string, dropTime: number): void {
  const from = p.scenes.findIndex((s) => s.id === sceneId);
  if (from < 0) return;
  const [scene] = p.scenes.splice(from, 1);
  const starts = sceneStarts(p.scenes);
  const center = dropTime + scene.duration / 2;
  let to = p.scenes.length;
  for (let i = 0; i < p.scenes.length; i++) {
    if (center <= starts[i] + p.scenes[i].duration / 2) {
      to = i;
      break;
    }
  }
  p.scenes.splice(to, 0, scene);
}
