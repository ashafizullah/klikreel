export type TrackKind = "video" | "overlay" | "audio";
export type AssetKind = "video" | "audio" | "image";

export interface Asset {
  id: string;
  path: string;
  name: string;
  kind: AssetKind;
  /** Seconds; 0 for images. */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export interface Transform {
  /** Offset from canvas centre, in output pixels. */
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
  opacity: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  background: string;
  align: "left" | "center" | "right";
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  italic: boolean;
}

export type ClipSource =
  | { type: "media"; assetId: string }
  | {
      type: "html";
      html: string;
      params: Record<string, string>;
      prompt?: string;
      /** Image name → workspace-relative path, exposed to the frame as window.__assets[name]. */
      assetRefs?: Record<string, string>;
    }
  | { type: "text"; text: string; style: TextStyle };

export interface Clip {
  id: string;
  name: string;
  /** Timeline position in seconds. */
  start: number;
  duration: number;
  /** Offset into the source (media time, or HTML frame local time). */
  trimIn: number;
  source: ClipSource;
  transform: Transform;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  /** Set on clips generated from a storyboard scene; the scene is the source of truth. */
  sceneId?: string;
}

export type TrackRole = "scenes" | "voice" | "music";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  clips: Clip[];
  /** Tracks managed by the storyboard layout. */
  role?: TrackRole;
}

export type SceneStatus = "pending" | "generating" | "ready" | "error";

export interface Scene {
  id: string;
  title: string;
  /** Voiceover script. */
  narration: string;
  /** What the scene shows; the brief for its HTML. */
  visual: string;
  duration: number;
  html: string;
  status: SceneStatus;
  error?: string;
  /** Image name → workspace-relative path. */
  assetRefs: Record<string, string>;
  /** Scene duration its HTML was designed (or last AI-synced) for. */
  designDuration?: number;
  /** Set when the user resized the scene; syncing keeps this length. */
  durationLocked?: boolean;
  voicePath?: string;
  voiceDuration?: number;
  /** Narration text the current voice file was generated from. */
  voiceText?: string;
  /** The AI-directed performance script (xAI tags) or delivery notes (OpenAI) used for the recording. */
  voiceScript?: string;
}

export interface Brief {
  prompt: string;
  language: string;
  targetDuration: number;
  tone: string;
  voiceEnabled: boolean;
  /** "scene": fit the voiceover into the scene; "narration": lengthen the scene to fit the voiceover. */
  voiceFit: "scene" | "narration";
  musicPath?: string;
  musicVolume: number;
}

export interface StyleGuide {
  productName: string;
  tagline: string;
  summary: string;
  palette: string[];
  fontFamily: string;
  mood: string;
  notes: string;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  workspaceId: string | null;
  brief: Brief;
  style: StyleGuide | null;
  scenes: Scene[];
  width: number;
  height: number;
  fps: number;
  background: string;
  /** tracks[0] is drawn on top of the timeline and composited on top. */
  tracks: Track[];
  assets: Record<string, Asset>;
}

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  fontSize: 96,
  fontWeight: 800,
  color: "#ffffff",
  background: "transparent",
  align: "center",
  strokeColor: "#000000",
  strokeWidth: 0,
  shadow: true,
  italic: false,
};

export function trackAccepts(kind: TrackKind, source: ClipSource, assets: Record<string, Asset>): boolean {
  if (source.type === "html" || source.type === "text") return kind === "overlay";
  const asset = assets[source.assetId];
  if (!asset) return false;
  return asset.kind === "audio" ? kind === "audio" : kind === "video";
}

export const DEFAULT_BRIEF: Brief = {
  prompt: "",
  language: "English",
  targetDuration: 30,
  tone: "energetic, modern, convincing",
  voiceEnabled: true,
  voiceFit: "scene",
  musicVolume: 0.25,
};
