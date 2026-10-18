// Revision agent: edits the generated video through scene-level tools.
import type { Scene } from "../types/project";
import { useProject } from "../store/project";
import { useImages } from "../store/images";
import { usePlayback } from "../store/playback";
import type { Message, ToolDef } from "./ipc";
import { ipc } from "./ipc";
import { newId } from "./ids";
import { runToolLoop, type ToolArgs } from "./toolLoop";
import { execWorkspaceTool, isWorkspaceTool, WORKSPACE_TOOLS } from "./workspaceTools";
import { generateSceneVisual, generateVoice } from "./producer";
import { sceneStarts } from "./scenes";

const SYSTEM = `You revise a generated product promo video. The video is a sequence of scenes; each scene has a title, a voiceover narration, a visual brief, a duration and an animated HTML page.

- Call get_storyboard first to see scene ids and content; never invent ids.
- To change what a scene looks like, call edit_scene_visual with a precise instruction. To rebuild it from scratch, update its visual brief and call edit_scene_visual without an instruction.
- After changing narration, call regenerate_voice so the voiceover matches.
- To use a photo or image from the product's project folder (a person, product, logo, screenshot), call find_images with words from its name, attach_image it to the scene, then call edit_scene_visual and name the asset in the instruction (e.g. "show the photo window.__assets.abdulah_hubai in a round frame"). Never invent image paths. If nothing matches, say so and list close matches.
- You can read the product's project folder (list_files, read_file, search_code, find_images) to check facts, real UI wording, names and brand details before changing anything.
- Keep the product's style consistent. Reply in the user's language with one or two sentences summarising what changed.`;

const str = { type: "string" };
const num = { type: "number" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

const TOOLS: ToolDef[] = [
  ...WORKSPACE_TOOLS,
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
  {
    name: "attach_image",
    description: "Makes a project image available to a scene as window.__assets.<name>. Call edit_scene_visual afterwards to show it.",
    parameters: obj({ scene_id: str, path: { ...str, description: "Path from find_images" }, name: { ...str, description: "Asset name (letters, digits, _); defaults to the file name" } }, ["scene_id", "path"]),
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
      // A failed voiceover is already on the activity log; still build the visual.
      const voiceError = scene.narration && store.project.brief.voiceEnabled ? await generateVoice(scene.id).then(() => null, (e) => String(e)) : null;
      await generateSceneVisual(scene.id);
      return voiceError ? { scene_id: scene.id, voice_error: voiceError } : { scene_id: scene.id };
    }
    case "attach_image": {
      const scene = requireScene(a.scene_id);
      const ws = store.project.workspaceId;
      if (!ws) throw new Error("this project has no workspace folder");
      const path = String(a.path);
      useImages.getState().put(path, await ipc.wsImage(ws, path));
      const stem = path.split("/").pop()!.replace(/\.[^.]+$/, "");
      const name = (s(a.name) || stem).replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
      store.updateScene(scene.id, { assetRefs: { ...scene.assetRefs, [name]: path } });
      return { ok: true, asset: name, use_as: `window.__assets.${name}` };
    }
    case "delete_scene":
      store.removeScene(requireScene(a.scene_id).id);
      return { ok: true };
    case "move_scene":
      store.moveScene(requireScene(a.scene_id).id, n(a.position) ?? 0);
      return { ok: true };
    default:
      if (isWorkspaceTool(name)) return execWorkspaceTool(store.project.workspaceId, name, a);
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

const SCENE_SYSTEM = `You edit one scene of a generated product promo video, following the user's instruction.

- You can read the product's project folder (list_files, read_file, search_code, find_images) for facts, names, real UI wording and images.
- To show a photo or image from the project folder, find it with find_images, attach_image it to this scene, then mention its window.__assets name in the edit_scene_visual instruction. Never invent image paths; if nothing matches, edit the scene without it.
- Finish by calling edit_scene_visual exactly once with a precise, self-contained instruction for this scene. Do not touch other scenes.`;

const SCENE_TOOLS = TOOLS.filter((t) => [...WORKSPACE_TOOLS.map((w) => w.name), "attach_image", "edit_scene_visual"].includes(t.name));

/**
 * Scene panel "edit with prompt": the AI may look into the project folder and
 * attach images before regenerating the scene. Falls back to a plain edit.
 */
export async function editSceneWithAI(sceneId: string, instruction: string): Promise<void> {
  const scene = requireScene(sceneId);
  let edited = false;
  const history: Message[] = [{
    role: "user",
    content: [{
      type: "text",
      text: `Scene id: ${scene.id}\nTitle: ${scene.title}\nNarration: ${scene.narration}\nVisual brief: ${scene.visual}\nImages already attached: ${Object.keys(scene.assetRefs).join(", ") || "none"}\n\nInstruction: ${instruction}`,
    }],
  }];
  const sceneExec = async (name: string, a: ToolArgs) => {
    if (name === "edit_scene_visual" || name === "attach_image") {
      if (String(a.scene_id) !== sceneId) throw new Error(`only scene ${sceneId} may be changed`);
      if (name === "edit_scene_visual") edited = true;
    }
    return exec(name, a);
  };
  try {
    await runToolLoop({ system: SCENE_SYSTEM, history, tools: SCENE_TOOLS, exec: sceneExec, maxSteps: 10, done: () => edited });
  } catch (e) {
    if (edited) throw e;
  }
  if (!edited) await generateSceneVisual(sceneId, instruction);
}
