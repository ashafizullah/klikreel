// Typed wrappers over the Rust commands.
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Asset } from "../types/project";

export type Role = "user" | "assistant";
export type Part =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string }
  | { type: "toolCall"; id: string; name: string; input: Record<string, unknown>; meta?: unknown }
  | { type: "toolResult"; id: string; name: string; content: string; isError?: boolean }
  | { type: "opaque"; provider: string; block: unknown };
export interface Message {
  role: Role;
  content: Part[];
}
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface Connection {
  format: string;
  profileId: string;
  model: string;
  baseUrl?: string | null;
}
export interface ChatRequest extends Connection {
  baseUrl?: string | null;
  system?: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
}
export interface ChatResult {
  message: Message;
  stopReason: string;
}
type AiStreamEvent = { type: "textDelta"; text: string };

export type RenderEvent =
  | { type: "status"; message: string }
  | { type: "progress"; ratio: number }
  | { type: "done"; output: string };

export interface SystemStatus {
  ffmpeg: string | null;
  ffprobe: string | null;
  chrome: string | null;
  os: "macos" | "windows" | "linux" | string;
  /** Command that installs ffmpeg (Homebrew on macOS). */
  ffmpegInstall: string | null;
  chromeInstall: string | null;
}

function textChannel(onText?: (t: string) => void) {
  const ch = new Channel<AiStreamEvent>();
  ch.onmessage = (e) => onText?.(e.text);
  return ch;
}

export const ipc = {
  apiKeysStatus: (profileIds: string[]) => invoke<Record<string, boolean>>("api_keys_status", { profileIds }),
  apiKeySet: (profileId: string, key: string) => invoke<void>("api_key_set", { profileId, key }),
  apiKeyDelete: (profileId: string) => invoke<void>("api_key_delete", { profileId }),

  chat: (request: ChatRequest, onText?: (t: string) => void) =>
    invoke<ChatResult>("ai_chat", { request, onEvent: textChannel(onText) }),
  generateFrame: (
    request: Connection & {
      prompt: string;
      duration: number;
      width: number;
      height: number;
      existingHtml?: string | null;
      scene?: boolean;
      context?: string;
    },
    onText?: (t: string) => void,
  ) => invoke<string>("ai_generate_frame", { request, onEvent: textChannel(onText) }),

  probe: (path: string) => invoke<Omit<Asset, "id">>("media_probe", { path }),
  thumbnails: (path: string, duration: number, count: number, height: number) =>
    invoke<string[]>("media_thumbnails", { path, duration, count, height }),
  retempo: (path: string, tempo: number) => invoke<string>("media_retempo", { path, tempo }),
  waveform: (path: string, buckets: number) => invoke<number[]>("media_waveform", { path, buckets }),

  systemStatus: () => invoke<SystemStatus>("system_status"),
  installInTerminal: (what: "ffmpeg" | "chrome") => invoke<void>("install_in_terminal", { what }),
  renderStart: (job: unknown, onEvent: (e: RenderEvent) => void) => {
    const ch = new Channel<RenderEvent>();
    ch.onmessage = onEvent;
    return invoke<void>("render_start", { job, onEvent: ch });
  },
  renderCancel: () => invoke<void>("render_cancel"),

  workspaces: () => invoke<Workspace[]>("workspaces_list"),
  workspaceAdd: (path: string, name?: string) => invoke<Workspace>("workspace_add", { path, name }),
  workspaceRename: (id: string, name: string) => invoke<void>("workspace_rename", { id, name }),
  workspaceRemove: (id: string) => invoke<void>("workspace_remove", { id }),
  projects: (workspaceId?: string) => invoke<ProjectMeta[]>("projects_list", { workspaceId }),
  projectStore: (id: string, json: string) => invoke<void>("project_store", { id, json }),
  projectFetch: (id: string) => invoke<string>("project_fetch", { id }),
  projectDelete: (id: string) => invoke<void>("project_delete", { id }),
  projectMedia: (id: string) => invoke<{ path: string; name: string; size: number; modified: number }[]>("project_media", { id }),
  projectMediaDelete: (id: string, name: string) => invoke<void>("project_media_delete", { id, name }),
  fileSizes: (paths: string[]) => invoke<number[]>("file_sizes", { paths }),

  wsOverview: (workspaceId: string) => invoke<string>("ws_overview", { workspaceId }),
  wsListFiles: (workspaceId: string, dir: string, depth?: number) => invoke<string[]>("ws_list_files", { workspaceId, dir, depth }),
  wsReadFile: (workspaceId: string, path: string) => invoke<string>("ws_read_file", { workspaceId, path }),
  wsSearch: (workspaceId: string, query: string) => invoke<string[]>("ws_search", { workspaceId, query }),
  wsImage: (workspaceId: string, path: string, maxWidth?: number) => invoke<string>("ws_image", { workspaceId, path, maxWidth }),
  wsImages: (workspaceId: string, query?: string) => invoke<string[]>("ws_images", { workspaceId, query }),

  ttsVoices: (profileId: string, baseUrl?: string | null) => invoke<{ id: string; name: string }[]>("tts_voices", { profileId, baseUrl }),
  ttsPreview: (request: { profileId: string; baseUrl?: string | null; engine?: string; text: string; model?: string; voice?: string; language?: string; speed?: number }) =>
    invoke<string>("tts_preview", { request }),
  tts: (
    projectId: string,
    name: string,
    request: { profileId: string; baseUrl?: string | null; engine?: string; text: string; model?: string; voice?: string; instructions?: string; language?: string; speed?: number },
  ) =>
    invoke<string>("tts_generate", { projectId, name, request }),
};

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  /** Video projects in this workspace and their total size on disk (bytes). */
  projectCount?: number;
  size?: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  workspaceId: string;
  width: number;
  height: number;
  scenes: number;
  updatedAt: number;
  /** First generated scene, for the card preview. */
  thumb: { html: string; duration: number; assets: Record<string, string> } | null;
  /** Bytes on disk (project file + generated media). */
  size: number;
}
