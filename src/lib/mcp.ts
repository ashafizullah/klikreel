// Tools the local MCP server offers to the user's own Claude Code. The Rust
// side relays each call here; edits go through the same stores as the UI, so
// the preview updates live and everything can be undone.
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Scene } from "../types/project";
import { useProject } from "../store/project";
import { useApp } from "../store/app";
import { track } from "../store/activity";
import { exec as execSceneTool, requireScene, TOOLS as SCENE_TOOLS } from "./agent";
import { duplicateScene, generateVoice, removeVoice, sceneContext, voiceSlot } from "./producer";
import { buildComposition } from "./composition";
import { buildRenderJob } from "./renderJob";
import { projectDuration } from "./timeline";
import { sceneStarts } from "./scenes";
import { newId } from "./ids";
import { ipc, type ToolDef } from "./ipc";
import { createProject, leaveProject, loadProject, projectBusy, setMusic } from "./library";
import { relayout } from "./scenes";
import type { ToolArgs } from "./toolLoop";

export interface McpInfo {
  url: string;
  token: string;
}

type McpCall = { id: number; name: string; arguments: ToolArgs };
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const INSTRUCTIONS = `KlikReel is the desktop video editor the user has open. These tools edit the video project currently open in it; the user sees every change live in the preview and can undo it.

The video is a sequence of full-screen scenes. Each scene has a title, a voiceover narration, a visual brief, a duration and an animated HTML page that you write yourself.

Workflow:
0. If no project is open, or the user means another one, use list_projects, then open_project or create_project. The workspace whose path matches your working directory is usually the right one.
1. get_storyboard to see the project, its style guide and scene ids (never invent ids). If the project is empty, set_style first, then add_scene for each scene.
2. get_scene before writing a scene: it returns the current HTML, the product/style context, narration timing and the exact HTML frame rules. Follow those rules strictly (window.__seek(t), GSAP timeline, no timers, no network).
3. set_scene_html to save the page; it is rejected with the reasons if it breaks the frame rules.
4. snapshot to look at the result and fix what looks wrong.
5. generate_voice after narration changes (uses the TTS voice configured in KlikReel), then re-check timing.
6. Optional: set_music for background music, update_brief for voiceover settings, update_project for the name and background.
7. export_video when the user asks for the final MP4.

The user's product codebase is usually your current working directory: read it for real names, wording, colors and logos. Images must be attached with attach_image (workspace-relative path) and used as window.__assets.<name>.`;

const str = { type: "string" };
const num = { type: "number" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

const reused = (name: string, description?: string): ToolDef => {
  const t = SCENE_TOOLS.find((x) => x.name === name)!;
  return description ? { ...t, description } : t;
};

const TOOLS: ToolDef[] = [
  {
    name: "list_projects",
    description: "Lists the workspaces (product folders) known to KlikReel and the video projects in each, and which project is open.",
    parameters: obj({}),
  },
  {
    name: "open_project",
    description: "Opens a video project in KlikReel (saving the one that is open). All other tools then act on it.",
    parameters: obj({ project_id: str }, ["project_id"]),
  },
  {
    name: "create_project",
    description: "Creates an empty video project and opens it. Give workspace_id from list_projects, or workspace_path (an absolute product folder, added as a workspace if needed).",
    parameters: obj(
      { name: str, workspace_id: str, workspace_path: str, format: { type: "string", enum: ["16:9", "9:16", "1:1", "4:5"], description: "Default 16:9 (1920x1080)" } },
      ["name"],
    ),
  },
  reused("get_storyboard", "Returns the open video project: format, brief, style guide and every scene (ids, timing, narration, visual brief, status)."),
  {
    name: "get_scene",
    description: "Returns one scene with its current HTML, the product/style context, narration timing and the HTML frame rules to follow when writing it.",
    parameters: obj({ scene_id: str }, ["scene_id"]),
  },
  {
    name: "set_scene_html",
    description: "Saves a complete HTML document as the scene's animated page. Rejected with reasons if it breaks the frame rules from get_scene.",
    parameters: obj({ scene_id: str, html: { ...str, description: "Complete HTML document" } }, ["scene_id", "html"]),
  },
  reused("update_scene", "Changes a scene's title, narration, visual brief or duration (seconds). Only pass fields that change. Retime the HTML afterwards if the duration changed."),
  {
    name: "add_scene",
    description: "Inserts a new scene. Pass html to set its page right away, or write it later with set_scene_html.",
    parameters: obj(
      { position: { ...num, description: "0-based index" }, title: str, narration: str, visual: { ...str, description: "What the scene shows" }, duration: num, html: str },
      ["position", "title", "visual", "duration"],
    ),
  },
  reused("delete_scene"),
  {
    name: "duplicate_scene",
    description: "Copies a scene (with its HTML and voiceover) right after the original.",
    parameters: obj({ scene_id: str }, ["scene_id"]),
  },
  reused("move_scene"),
  reused("find_images"),
  reused("attach_image", "Makes an image from the product folder available to a scene as window.__assets.<name>. Then reference it in the scene HTML."),
  {
    name: "set_style",
    description: "Sets the project's style guide used across scenes. Only pass fields that change.",
    parameters: obj({
      productName: str, tagline: str, summary: str,
      palette: { type: "array", items: str, description: "Hex colors" },
      fontFamily: { ...str, description: "System font stack" }, mood: str, notes: { ...str, description: "Transitions, layout and motion notes" },
    }),
  },
  {
    name: "update_brief",
    description: "Changes the video brief: what it is about, the on-screen/voice language, tone, target length and voiceover settings.",
    parameters: obj({
      prompt: str, language: str, tone: str, targetDuration: num,
      voiceEnabled: { type: "boolean", description: "Whether scenes get a voiceover" },
      voiceFit: { type: "string", enum: ["scene", "narration"], description: "scene: fit the voiceover into the scene length; narration: lengthen the scene to fit the voiceover" },
    }),
  },
  {
    name: "update_project",
    description: "Renames the project or changes its background color (shown behind transparent layers).",
    parameters: obj({ name: str, background: { ...str, description: "Hex color, e.g. #000000" } }),
  },
  {
    name: "set_music",
    description: "Sets, changes the volume of, or removes the background music that spans the whole video.",
    parameters: obj({
      path: { ...str, description: "Audio file: absolute, or relative to the product folder. Empty string removes the music." },
      volume: { ...num, description: "0 to 1 (default 0.25)" },
    }),
  },
  {
    name: "generate_voice",
    description: "Records the scene's voiceover from its current narration with the TTS voice configured in KlikReel. The scene may get longer to fit it; returns the new timing.",
    parameters: obj({ scene_id: str }, ["scene_id"]),
  },
  {
    name: "remove_voice",
    description: "Removes a scene's voiceover from the timeline (the recording stays in the project's media).",
    parameters: obj({ scene_id: str }, ["scene_id"]),
  },
  {
    name: "snapshot",
    description: "Renders still frames of the video so you can check how it looks. With scene_id, times are seconds from that scene's start (default: after the entrance, middle, before the exit); without, times are on the whole timeline.",
    parameters: obj({ scene_id: str, times: { type: "array", items: num, description: "Up to 4 times in seconds" } }),
  },
  {
    name: "export_video",
    description: "Renders the whole video to an MP4 file. Takes a while; returns the output path.",
    parameters: obj({ path: { ...str, description: "Absolute output path ending in .mp4" }, quality: { type: "string", enum: ["standard", "high"] } }, ["path"]),
  },
];

const s = (v: unknown) => (typeof v === "string" ? v : undefined);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

async function saveHtml(scene: Scene, html: string) {
  const issues = await invoke<string[]>("frame_check", { html });
  if (issues.length) throw new Error(`Not saved. Fix these frame rule violations:\n- ${issues.join("\n- ")}`);
  const duration = useProject.getState().project.scenes.find((x) => x.id === scene.id)?.duration ?? scene.duration;
  useProject.getState().updateScene(scene.id, { html, status: "ready", error: undefined, designDuration: duration });
}

async function snapshot(a: ToolArgs): Promise<Content[]> {
  const { project } = useProject.getState();
  const comp = buildComposition(project);
  if (!comp) throw new Error("the timeline has no scenes to show yet");
  let times = Array.isArray(a.times) ? a.times.map(Number).filter(Number.isFinite).slice(0, 4) : [];
  const total = projectDuration(project);
  if (a.scene_id !== undefined) {
    const scene = requireScene(a.scene_id);
    const start = sceneStarts(project.scenes)[project.scenes.indexOf(scene)];
    if (!times.length) times = [Math.min(1, scene.duration / 2), scene.duration / 2, Math.max(0, scene.duration - 0.5)];
    times = times.map((t) => start + Math.max(0, Math.min(scene.duration - 0.01, t)));
  } else if (!times.length) {
    times = [total * 0.15, total * 0.5, total * 0.85];
  }
  times = times.map((t) => Math.max(0, Math.min(total - 0.01, t)));
  const shots = await invoke<string[]>("frame_snapshot", {
    html: comp.html, width: project.width, height: project.height, times, background: project.background, maxWidth: 960,
  });
  return shots.flatMap((uri, i) => [
    { type: "text" as const, text: `t = ${times[i].toFixed(2)}s` },
    { type: "image" as const, data: uri.slice(uri.indexOf(",") + 1), mimeType: "image/jpeg" },
  ]);
}

async function exportVideo(a: ToolArgs, progress: (text: string) => void) {
  const path = String(a.path ?? "");
  if (!/^(\/|[A-Za-z]:[\\/]).*\.mp4$/i.test(path)) throw new Error("path must be an absolute file path ending in .mp4");
  const high = a.quality === "high";
  await ipc.renderStart(buildRenderJob(useProject.getState().project, { output: path, crf: high ? 14 : 18, preset: high ? "slow" : "medium", fullColor: false }), (e) => {
    if (e.type === "progress") progress(`${Math.round(e.ratio * 100)}%`);
  });
  return { ok: true, output: path };
}

const FORMATS: Record<string, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };

async function listProjects() {
  const [workspaces, projects] = await Promise.all([ipc.workspaces(), ipc.projects()]);
  const open = useApp.getState().view === "project" ? useProject.getState().project.id : null;
  return {
    open_project_id: open,
    workspaces: workspaces.map((w) => ({
      id: w.id, name: w.name, path: w.path,
      projects: projects.filter((p) => p.workspaceId === w.id).sort((x, y) => y.updatedAt - x.updatedAt).map((p) => ({
        id: p.id, name: p.name, format: `${p.width}x${p.height}`, scenes: p.scenes, updated: new Date(p.updatedAt).toISOString(), open: p.id === open,
      })),
    })),
  };
}

/** Saves and leaves the open project; refuses while one of the app's own AI jobs still writes to it. */
async function leave() {
  if (useApp.getState().view === "project" && projectBusy()) throw new Error("KlikReel is still generating in the open project; wait until it finishes and try again.");
  await leaveProject();
}

async function run(name: string, a: ToolArgs, progress: (text: string) => void): Promise<unknown> {
  const store = useProject.getState();
  switch (name) {
    case "list_projects":
      return listProjects();
    case "open_project": {
      const id = String(a.project_id ?? "");
      if (!(await ipc.projects()).some((p) => p.id === id)) throw new Error(`project ${id} not found; call list_projects`);
      if (useApp.getState().view === "project" && store.project.id === id) return { ok: true, already_open: true };
      await leave();
      await loadProject(id);
      return { ok: true, name: useProject.getState().project.name };
    }
    case "create_project": {
      let wsId = s(a.workspace_id);
      if (!wsId && s(a.workspace_path)) {
        const path = s(a.workspace_path)!.replace(/[\\/]+$/, "");
        const known = (await ipc.workspaces()).find((w) => w.path.replace(/[\\/]+$/, "") === path);
        wsId = known?.id ?? (await ipc.workspaceAdd(path)).id;
        await useApp.getState().refresh();
      }
      if (!wsId) throw new Error("pass workspace_id or workspace_path (see list_projects)");
      if (!(await ipc.workspaces()).some((w) => w.id === wsId)) throw new Error(`workspace ${wsId} not found; call list_projects`);
      const [width, height] = FORMATS[s(a.format) ?? "16:9"] ?? FORMATS["16:9"];
      await leave();
      await createProject(wsId, s(a.name) || "Untitled Project", width, height);
      return { ok: true, project_id: useProject.getState().project.id, format: `${width}x${height}` };
    }
    case "get_scene": {
      const scene = requireScene(a.scene_id);
      const { width, height } = store.project;
      return [
        `# Scene ${scene.id}: ${scene.title}`,
        `Duration: ${scene.duration}s · status: ${scene.status}${scene.voiceDuration ? ` · voiceover ${scene.voiceDuration.toFixed(1)}s` : ""}`,
        await sceneContext(scene.id),
        `# HTML frame rules\n${await invoke<string>("frame_rules", { width, height, duration: scene.duration })}`,
        `# Current HTML\n${scene.html || "(none yet)"}`,
      ].join("\n\n");
    }
    case "set_scene_html":
      await saveHtml(requireScene(a.scene_id), String(a.html ?? ""));
      return { ok: true };
    case "add_scene": {
      const scene: Scene = {
        id: newId("scn"), title: String(a.title), narration: s(a.narration) ?? "", visual: String(a.visual),
        duration: Math.max(1, n(a.duration) ?? 4), html: "", status: "pending", assetRefs: {},
      };
      const scenes = [...store.project.scenes];
      scenes.splice(Math.max(0, Math.min(scenes.length, n(a.position) ?? scenes.length)), 0, scene);
      store.setScenes(scenes);
      if (s(a.html)) await saveHtml(scene, s(a.html)!);
      return { scene_id: scene.id };
    }
    case "set_style": {
      const patch = Object.fromEntries(
        ["productName", "tagline", "summary", "fontFamily", "mood", "notes"].filter((k) => s(a[k]) !== undefined).map((k) => [k, s(a[k])]),
      );
      if (Array.isArray(a.palette)) patch.palette = a.palette.map(String) as never;
      store.update((p) => {
        p.style = { productName: "", tagline: "", summary: "", palette: [], fontFamily: "", mood: "", notes: "", ...p.style, ...patch };
      });
      return { ok: true, style: useProject.getState().project.style };
    }
    case "update_brief":
      store.update((p) => {
        if (s(a.prompt) !== undefined) p.brief.prompt = s(a.prompt)!;
        if (s(a.language)) p.brief.language = s(a.language)!;
        if (s(a.tone)) p.brief.tone = s(a.tone)!;
        if (n(a.targetDuration)) p.brief.targetDuration = n(a.targetDuration)!;
        if (typeof a.voiceEnabled === "boolean") p.brief.voiceEnabled = a.voiceEnabled;
        if (a.voiceFit === "scene" || a.voiceFit === "narration") p.brief.voiceFit = a.voiceFit;
      });
      return { ok: true, brief: useProject.getState().project.brief };
    case "update_project": {
      const bg = s(a.background);
      if (bg !== undefined && !/^#[0-9a-fA-F]{6}$/.test(bg)) throw new Error("background must be a hex color like #000000");
      store.update((p) => {
        if (s(a.name)?.trim()) p.name = s(a.name)!.trim();
        if (bg) p.background = bg;
      });
      return { ok: true };
    }
    case "set_music": {
      if (s(a.path) !== undefined) {
        const raw = s(a.path)!.trim();
        const ws = useApp.getState().workspaces.find((w) => w.id === store.project.workspaceId);
        const absolute = /^(\/|[A-Za-z]:[\\/])/.test(raw);
        if (raw && !absolute && !ws) throw new Error("pass an absolute path; this project has no product folder");
        await setMusic(raw ? (absolute ? raw : `${ws!.path.replace(/[\\/]+$/, "")}/${raw}`) : null);
      }
      const volume = n(a.volume);
      if (volume !== undefined) {
        useProject.getState().update((p) => {
          p.brief.musicVolume = Math.max(0, Math.min(1, volume));
          relayout(p);
        });
      }
      const { brief } = useProject.getState().project;
      return { music: brief.musicPath ?? null, volume: brief.musicVolume };
    }
    case "duplicate_scene": {
      const scene = requireScene(a.scene_id);
      const before = new Set(store.project.scenes.map((x) => x.id));
      duplicateScene(scene.id);
      const copy = useProject.getState().project.scenes.find((x) => !before.has(x.id));
      return { scene_id: copy?.id };
    }
    case "remove_voice":
      removeVoice(requireScene(a.scene_id).id);
      return { ok: true };
    case "generate_voice": {
      const scene = requireScene(a.scene_id);
      if (!scene.narration.trim()) throw new Error("the scene has no narration; set it with update_scene first");
      const before = scene.duration;
      await generateVoice(scene.id, { autoSync: false, condense: false });
      const after = requireScene(scene.id);
      return {
        voice_duration: after.voiceDuration, scene_duration: after.duration, fits_in: +voiceSlot(before).toFixed(2),
        note: after.duration > before + 0.05
          ? `The voiceover was longer than the scene, so the scene grew from ${before}s to ${after.duration}s. Retime its HTML (get_scene, set_scene_html) or shorten the narration and record again.`
          : undefined,
      };
    }
    case "snapshot":
      return { __content: await snapshot(a) };
    case "export_video":
      return exportVideo(a, progress);
    default:
      return execSceneTool(name, a);
  }
}

const ALLOWED = new Set(TOOLS.map((t) => t.name));
const PROJECTLESS = new Set(["list_projects", "open_project", "create_project"]);

function toContent(out: unknown): Content[] {
  if (out && typeof out === "object" && "__content" in out) return (out as { __content: Content[] }).__content;
  return [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 1) }];
}

async function handle(call: McpCall) {
  const line = track(`Claude Code · ${call.name}`);
  let result: { content: Content[]; isError?: boolean };
  try {
    if (!ALLOWED.has(call.name)) throw new Error(`unknown tool: ${call.name}`);
    if (!PROJECTLESS.has(call.name) && useApp.getState().view !== "project") throw new Error("No video project is open in KlikReel. Use list_projects, then open_project or create_project.");
    result = { content: toContent(await run(call.name, call.arguments ?? {}, (p) => line.progress(`Claude Code · ${call.name} ${p}`))) };
    line.done(`Claude Code · ${call.name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result = { content: [{ type: "text", text: msg }], isError: true };
    line.fail(`Claude Code · ${call.name}: ${msg}`);
  }
  await invoke("mcp_reply", { id: call.id, result });
}

export interface McpLink {
  running: boolean;
  connected: boolean;
  client: string | null;
  idleSecs: number | null;
}

interface McpState {
  enabled: boolean;
  info: McpInfo | null;
  link: McpLink | null;
  setEnabled(on: boolean): Promise<void>;
}

export const useMcp = create<McpState>()(
  persist(
    (set) => ({
      enabled: false,
      info: null,
      link: null,
      setEnabled: async (enabled) => {
        if (!enabled) {
          await invoke("mcp_stop");
          set({ enabled, info: null, link: null });
          return;
        }
        const onCall = new Channel<McpCall>();
        onCall.onmessage = (c) => void handle(c);
        const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters }));
        const info = await invoke<McpInfo>("mcp_start", { tools, instructions: INSTRUCTIONS, onCall });
        set({ enabled, info });
      },
    }),
    { name: "klikreel-mcp", partialize: (s) => ({ enabled: s.enabled }) },
  ),
);

/** Polls whether Claude Code is connected while the server runs. */
export function useMcpLink(): McpLink | null {
  const enabled = useMcp((s) => s.enabled);
  useEffect(() => {
    if (!enabled) return;
    const poll = () => invoke<McpLink>("mcp_link").then((link) => useMcp.setState({ link }), () => {});
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [enabled]);
  return useMcp((s) => (s.enabled ? s.link : null));
}

/**
 * Restarts the server on launch when the user left it on. Runs on every
 * evaluation of this module: after a dev hot reload re-creates the stores,
 * the bridge must point at the new ones or edits land in stale state.
 */
if (useMcp.getState().enabled) useMcp.getState().setEnabled(true).catch(() => useMcp.setState({ enabled: false }));

export const addCommand = (info: McpInfo) =>
  `claude mcp add --transport http --scope user klikreel ${info.url} --header "Authorization: Bearer ${info.token}"`;
