// Revision agent: edits the generated video through scene-level tools.
import type { Scene } from "../types/project";
import { useProject } from "../store/project";
import { usePlayback } from "../store/playback";
import type { Message, ToolDef } from "./ipc";
import { newId } from "./ids";
import { runToolLoop, type ToolArgs } from "./toolLoop";
import { generateSceneVisual, generateVoice } from "./producer";
import { sceneStarts } from "./scenes";

const SYSTEM = `You revise a generated product promo video. The video is a sequence of scenes; each scene has a title, a voiceover narration, a visual brief, a duration and an animated HTML page.

- Call get_storyboard first to see scene ids and content; never invent ids.
- To change what a scene looks like, call edit_scene_visual with a precise instruction. To rebuild it from scratch, update its visual brief and call edit_scene_visual without an instruction.
- After changing narration, call regenerate_voice so the voiceover matches.
- Keep the product's style consistent. Reply in the user's language with one or two sentences summarising what changed.`;

const str = { type: "string" };
const num = { type: "number" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

const TOOLS: ToolDef[] = [
  { name: "get_storyboard", description: "Returns the video settings, style guide and every scene.", parameters: obj({}) },
  {
    name: "update_scene",
    description: "Changes a scene's title, narration, visual brief or duration. Only pass fields that change.",
    parameters: obj({ scene_id: str, title: str, narration: str, visual: str, duration: num }, ["scene_id"]),
  },
  {
    name: "edit_scene_visual",
    description: "Regenerates a scene's HTML. With an instruction it edits the current page; without one it rebuilds from the visual brief.",
    parameters: obj({ scene_id: str, instruction: str }, ["scene_id"]),
  },
  { name: "regenerate_voice", description: "Records the voiceover again from the scene's current narration.", parameters: obj({ scene_id: str }, ["scene_id"]) },
  {
    name: "add_scene",
    description: "Inserts a new scene and generates its HTML (and voiceover when narration is given).",
    parameters: obj({ position: { ...num, description: "0-based index" }, title: str, narration: str, visual: str, duration: num }, ["position", "title", "visual", "duration"]),
  },
  { name: "delete_scene", description: "Removes a scene.", parameters: obj({ scene_id: str }, ["scene_id"]) },
  { name: "move_scene", description: "Moves a scene to a new 0-based position.", parameters: obj({ scene_id: str, position: num }, ["scene_id", "position"]) },
];

function storyboard() {
  const { project } = useProject.getState();
  const starts = sceneStarts(project.scenes);
  return {
    format: `${project.width}x${project.height} @ ${project.fps}fps`,
    brief: project.brief.prompt,
    language: project.brief.language,
    style: project.style,
    scenes: project.scenes.map((s, i) => ({
      id: s.id, position: i, start: +starts[i].toFixed(2), duration: s.duration, title: s.title,
      narration: s.narration, visual: s.visual, status: s.status, has_voice: !!s.voicePath, images: Object.keys(s.assetRefs),
    })),
  };
}

function requireScene(id: unknown): Scene {
  const scene = useProject.getState().project.scenes.find((s) => s.id === String(id));
  if (!scene) throw new Error(`scene ${String(id)} not found; call get_storyboard`);
  return scene;
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

async function exec(name: string, a: ToolArgs): Promise<unknown> {
  const store = useProject.getState();
  switch (name) {
    case "get_storyboard":
      return storyboard();
    case "update_scene": {
      const scene = requireScene(a.scene_id);
      const patch: Partial<Scene> = {};
      if (s(a.title)) patch.title = s(a.title);
      if (s(a.narration) !== undefined) patch.narration = s(a.narration);
      if (s(a.visual)) patch.visual = s(a.visual);
      if (n(a.duration)) patch.duration = Math.max(1, n(a.duration)!);
      store.updateScene(scene.id, patch);
      return { ok: true };
    }
    case "edit_scene_visual":
      await generateSceneVisual(requireScene(a.scene_id).id, s(a.instruction));
      return { ok: true };
    case "regenerate_voice":
      await generateVoice(requireScene(a.scene_id).id);
      return { ok: true, duration: requireScene(a.scene_id).duration };
    case "add_scene": {
      const scene: Scene = {
        id: newId("scn"), title: String(a.title), narration: s(a.narration) ?? "", visual: String(a.visual),
        duration: Math.max(1, n(a.duration) ?? 4), html: "", status: "pending", assetRefs: {},
      };
      const scenes = [...store.project.scenes];
      scenes.splice(Math.max(0, Math.min(scenes.length, n(a.position) ?? scenes.length)), 0, scene);
      store.setScenes(scenes);
      if (scene.narration && store.project.brief.voiceEnabled) await generateVoice(scene.id);
      await generateSceneVisual(scene.id);
      return { scene_id: scene.id };
    }
    case "delete_scene":
      store.removeScene(requireScene(a.scene_id).id);
      return { ok: true };
    case "move_scene":
      store.moveScene(requireScene(a.scene_id).id, n(a.position) ?? 0);
      return { ok: true };
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export interface AgentCallbacks {
  onText(delta: string): void;
  onMessage(m: Message): void;
  onTool(name: string, input: ToolArgs, result: string, isError: boolean): void;
}

export function runAgent(history: Message[], cb: AgentCallbacks, signal: { cancelled: boolean }): Promise<string> {
  usePlayback.getState().pause();
  return runToolLoop({ system: SYSTEM, history, tools: TOOLS, exec, signal, maxSteps: 16, ...cb });
}
