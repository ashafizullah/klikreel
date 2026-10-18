// "Prompt → video": researches the workspace codebase, writes a storyboard,
// records voiceovers and generates one HTML page per scene.
import type { Scene, StyleGuide } from "../types/project";
import { useProject } from "../store/project";
import { useImages } from "../store/images";
import { activeModel, activeVoice, ttsConnection } from "../store/settings";
import type { Message, ToolDef } from "./ipc";
import { ipc } from "./ipc";
import { newId } from "./ids";
import { runToolLoop, type ToolArgs } from "./toolLoop";
import { exactFit, fitDuration, VOICE_LEAD, VOICE_TAIL } from "./scenes";
import { localizeMessage, t } from "../i18n";
import { track } from "../store/activity";

export type LogEntry = { kind: "info" | "tool" | "error" | "done"; text: string };
export type Log = (e: LogEntry) => void;

/** Narration language ("Indonesian", "English", "id", …) as a BCP-47 code; "auto" if unknown. */
export function languageCode(language: string): string {
  const l = language.trim().toLowerCase();
  const names: Record<string, string> = {
    english: "en", inggris: "en", indonesian: "id", indonesia: "id", "bahasa indonesia": "id", japanese: "ja",
    korean: "ko", chinese: "zh", mandarin: "zh", french: "fr", german: "de", spanish: "es-ES", portuguese: "pt-BR",
    italian: "it", arabic: "ar-SA", hindi: "hi", russian: "ru", turkish: "tr", vietnamese: "vi", bengali: "bn",
  };
  if (names[l]) return names[l];
  return /^[a-z]{2}(-[a-z]{2})?$/i.test(l) ? language.trim() : "auto";
}

const errText = (e: unknown) => localizeMessage(e instanceof Error ? e.message : String(e));
const kChars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

interface Storyboard {
  product_name: string;
  tagline: string;
  summary: string;
  style: { palette: string[]; font_family: string; mood: string; notes: string };
  logo_path?: string;
  scenes: { title: string; narration: string; visual: string; duration: number; images?: string[] }[];
}

const str = { type: "string" };
const RESEARCH_TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description: "Lists files and folders (folders end with /) in the workspace codebase. Dependency and build folders are skipped.",
    parameters: { type: "object", properties: { dir: { ...str, description: "Folder relative to the workspace root; empty for root" }, depth: { type: "number" } }, required: ["dir"] },
  },
  {
    name: "read_file",
    description: "Reads a text file from the workspace (first 60 KB).",
    parameters: { type: "object", properties: { path: str }, required: ["path"] },
  },
  {
    name: "search_code",
    description: "Case-insensitive text search across the workspace. Returns path:line: text matches.",
    parameters: { type: "object", properties: { query: str }, required: ["query"] },
  },
  {
    name: "submit_storyboard",
    description: "Submits the final storyboard. Call exactly once when research is done.",
    parameters: {
      type: "object",
      properties: {
        product_name: str,
        tagline: str,
        summary: { ...str, description: "What the product and the promoted feature do, for whom, key benefits and real UI wording found in the code (4-8 sentences)" },
        style: {
          type: "object",
          properties: {
            palette: { type: "array", items: str, description: "Hex colors, brand colors from the codebase when found" },
            font_family: { ...str, description: "CSS font stack using system fonts only" },
            mood: str,
            notes: { ...str, description: "Shared visual language so all scenes look like one video, including one transition style used for every scene entrance and exit (e.g. slide up with a soft blur, or scale-in from the center)" },
          },
          required: ["palette", "font_family", "mood", "notes"],
        },
        logo_path: { ...str, description: "Workspace-relative path of the logo image, if one exists" },
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: str,
              narration: { ...str, description: "Voiceover script for this scene, written exactly as it should be spoken" },
              visual: {
                ...str,
                description: "Structured brief: 'On-screen text:' exact headline (max 6 words) and optional supporting line; 'Layout:' composition and UI elements; 'Key moment:' the one thing that happens; 'Motion:' entrance, ambient motion and exit",
              },
              duration: { type: "number", description: "Seconds" },
              images: { type: "array", items: str, description: "Workspace-relative image paths to show (screenshots)" },
            },
            required: ["title", "narration", "visual", "duration"],
          },
        },
      },
      required: ["product_name", "tagline", "summary", "style", "scenes"],
    },
  },
];

/** Typical TTS speaking rate; words in languages like Indonesian are longer, so fewer fit per second. */
export function wordsPerSecond(language: string): number {
  const code = languageCode(language).split("-")[0];
  const rates: Record<string, number> = { en: 2.5, id: 1.9, ms: 1.9, de: 2.0, fi: 1.8, ru: 2.0, tr: 1.9, es: 2.4, pt: 2.3, fr: 2.4, it: 2.3, vi: 2.6 };
  return rates[code] ?? 2.2;
}

function producerSystem(language: string, tone: string, target: number, width: number, height: number) {
  const orientation = width > height ? "landscape" : width < height ? "vertical (9:16 social)" : "square";
  const wps = wordsPerSecond(language);
  return `You are a creative director producing a short promo video for the software product whose codebase is in the user's workspace.

1. Research first. Use list_files, search_code and read_file to learn what the product does and, above all, the feature the user wants to promote: who it is for, the problem it solves, its key benefits, and the real UI labels, button texts and copy used in the code. Also look for brand colors (Tailwind config, CSS variables, theme files), a logo file and product screenshots. Stay focused: about 6 to 12 tool calls. Do not ask the user questions.
2. Then call submit_storyboard once.

Storyboard rules:
- Total duration about ${target} seconds, ${orientation} ${width}x${height}. Usually 4 to 8 scenes of 3 to 8 seconds.
- Tone of the whole video: ${tone}.
- Scene 1 is a hook that lands in the first 1-2 seconds: a sharp pain point, a bold claim or a question the viewer recognises. Middle scenes show the feature in action with simplified UI mockups that use real labels from the code, one idea per scene. The last scene is a call to action with the product name (and logo if available).
- Narration is one continuous script split across scenes: each line follows on from the previous one, with no repeated greetings and the product name said at most twice in the whole video.
- Narration is in ${language}: natural and conversational, short sentences, no stage directions. Budget about ${wps} words per second of scene, minus about 1 second per scene for breathing room.
- Write narration exactly as it is spoken: spell out numbers, prices, units and dates in words in ${language} (e.g. "Rp 50.000" becomes the spoken form), write acronyms the way they are pronounced when that is not obvious, and never include URLs, emoji, hashtags or symbols such as /, &, %, # or +.
- All on-screen text is in ${language}; only real UI labels from the code stay exactly as they appear in the product.
- "visual" must be concrete enough for a designer to build the scene as an animated HTML page, following the field's structure.
- Only reference image paths you saw in file listings. Prefer brand colors found in the code for the palette.`;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

/** Pixel size of an image data URI, or null where it cannot be measured. */
function imageSize(src: string): Promise<{ w: number; h: number } | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function sceneContext(sceneId: string): Promise<string> {
  const { project } = useProject.getState();
  const i = project.scenes.findIndex((s) => s.id === sceneId);
  const scene = project.scenes[i];
  const st = project.style;
  const lines: string[] = [];
  if (st) {
    lines.push(
      `## Product\n${st.productName}: ${st.tagline}\n${st.summary}`,
      `## Style guide (apply consistently to every scene)\nPalette: ${st.palette.join(", ")}\nFont stack: ${st.fontFamily} (system fonts only)\nMood: ${st.mood}\n${st.notes}`,
    );
  }
  const prev = project.scenes[i - 1];
  const next = project.scenes[i + 1];
  lines.push(
    `## Video\nScene ${i + 1} of ${project.scenes.length}, canvas ${project.width}x${project.height}. On-screen text language: ${project.brief.language}.` +
      (prev ? ` Previous scene: "${prev.title}" (${prev.visual.split("\n")[0].slice(0, 160)}).` : " This is the opening scene: grab attention immediately.") +
      (next ? ` Next scene: "${next.title}".` : " This is the closing scene: end on the call to action, fully visible at the end."),
    `## This scene: ${scene.title}\nVoiceover (do not render all of it as text): ${scene.narration}\nVisual brief: ${scene.visual}`,
  );
  if (scene.voiceDuration) {
    const end = Math.min(VOICE_LEAD + scene.voiceDuration, scene.duration);
    lines.push(`## Narration timing\nThe voiceover plays from ${VOICE_LEAD.toFixed(1)}s to ${end.toFixed(1)}s. Estimated timing:\n${narrationCues(scene.narration, VOICE_LEAD, scene.voiceDuration)}`);
  }
  const images = useImages.getState().images;
  const names = Object.entries(scene.assetRefs).filter(([, path]) => images[path]);
  const described = await Promise.all(names.map(async ([n, p]) => {
    const size = await imageSize(images[p]);
    const shape = size ? `, ${size.w}x${size.h} ${size.w > size.h * 1.1 ? "landscape" : size.h > size.w * 1.1 ? "portrait" : "square"}` : "";
    return `- ${n}: ${p}${shape}`;
  }));
  lines.push(
    names.length
      ? `## Images available in window.__assets\n${described.join("\n")}`
      : "## Images\nNo images are available; draw UI and logos with HTML/CSS/SVG.",
  );
  return lines.join("\n\n");
}

/** Generates (or, with `instruction`, edits) the HTML of one scene. */
export async function generateSceneVisual(sceneId: string, instruction?: string): Promise<void> {
  const store = useProject.getState();
  const scene = store.project.scenes.find((s) => s.id === sceneId);
  if (!scene) return;
  const editing = !!instruction && !!scene.html;
  const title = scene.title;
  const label = t(editing ? "prod.sceneEditing" : "prod.sceneBuilding", { title });
  const line = track(label);
  let chars = 0;
  store.updateScene(sceneId, { status: "generating", error: undefined });
  try {
    const { width, height } = useProject.getState().project;
    const html = await ipc.generateFrame({
      ...activeModel(),
      prompt: instruction || scene.visual,
      duration: scene.duration,
      width,
      height,
      existingHtml: editing ? scene.html : null,
      scene: true,
      context: await sceneContext(sceneId),
    }, (delta) => {
      chars += delta.length;
      line.progress(t("prod.sceneWriting", { label, n: kChars(chars) }));
    });
    useProject.getState().updateScene(sceneId, { html, status: "ready", designDuration: scene.duration });
    line.done(t(editing ? "prod.sceneUpdated" : "prod.sceneDone", { title }));
  } catch (e) {
    useProject.getState().updateScene(sceneId, { status: "error", error: errText(e) });
    line.fail(t("prod.sceneFailed", { title, err: errText(e) }));
    throw e;
  }
}

/** Narration up to this much longer than its slot is sped up instead of rewritten. */
const REWRITE_ABOVE = 1.1;
/** Fastest playback applied to fit a slot; faster starts to sound rushed. */
const MAX_TEMPO = 1.15;

/** Seconds of narration that fit inside a scene. */
export function voiceSlot(duration: number): number {
  return Math.max(1, duration - VOICE_LEAD - VOICE_TAIL);
}

/** Speed-up needed to fit `voice` seconds into `slot` (1 = none), or null if beyond MAX_TEMPO. */
export function fitTempo(voice: number, slot: number): number | null {
  if (voice <= slot * 1.01) return 1;
  const tempo = voice / slot;
  return tempo <= MAX_TEMPO ? Math.round(tempo * 1000) / 1000 : null;
}

async function shortenNarration(text: string, seconds: number, language: string): Promise<string> {
  const words = Math.max(3, Math.floor(seconds * wordsPerSecond(language)));
  const res = await ipc.chat({
    ...activeModel(),
    maxTokens: 2000,
    system: "You edit voiceover scripts for product promo videos. Output only the rewritten line, no quotes or commentary.",
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: `Rewrite this voiceover line in ${language} so it is spoken in about ${seconds.toFixed(1)} seconds (at most ${words} words). Keep the meaning, product and feature names, and the tone. Keep numbers, prices and acronyms written out as they are spoken, with no symbols or URLs.\n\n${text}`,
      }],
    }],
  });
  const out = res.message.content.map((p) => (p.type === "text" ? p.text : "")).join("").trim().replace(/^["“]|["”]$/g, "");
  return out || text;
}

/**
 * How audible the direction should be. Measured on xAI: <emphasis> and pitch
 * tags on short phrases barely change the audio, while <whisper>, <loud>,
 * [laugh], [pause] and <build-intensity>/<slow> over full phrases do.
 */
const INTENSITY_RULES = {
  subtle: "- Use 2–3 gentle tags: a [breath] or [pause] before a reveal and <emphasis> on the key benefit phrase.",
  normal:
    "- Use 3–5 tags so the delivery is clearly expressive: a [breath] or [pause] before a reveal, <emphasis> on the key benefit phrase, <build-intensity> toward an exciting point, <soft> or <slow> for empathy. Only use laughter if it truly fits.",
  strong: [
    "- Direct boldly so the change is obvious to the ear (4–7 tags). Prefer the tags that audibly change the voice: <whisper>, <soft>, <loud>, <build-intensity>, <decrease-intensity>, <slow>, <fast>, [pause], [long-pause], [breath], [sigh], [laugh], [chuckle].",
    "- <emphasis>, <higher-pitch> and <lower-pitch> are subtle: only use them around whole phrases and together with a stronger tag.",
    "- Shape a contrast within the line: e.g. a pain point <slow><soft>…</soft></slow> or with a [sigh], then the solution <build-intensity>…</build-intensity> or <loud>…</loud>; a secret or reassurance in <whisper>; a [laugh] or [chuckle] for a playful moment.",
  ].join("\n"),
} as const;

const XAI_TAGS = {
  inline: ["[pause]", "[long-pause]", "[breath]", "[inhale]", "[exhale]", "[sigh]", "[laugh]", "[chuckle]", "[giggle]", "[tsk]", "[tongue-click]", "[lip-smack]", "[hum-tune]", "[cry]"],
  wrap: ["soft", "whisper", "loud", "build-intensity", "decrease-intensity", "higher-pitch", "lower-pitch", "slow", "fast", "emphasis", "sing-song", "singing"],
};

/** Removes xAI speech tags, leaving the spoken words. */
export function stripSpeechTags(script: string): string {
  return script
    .replace(/\[[a-z-]+\]/g, " ")
    .replace(/<\/?[a-z-]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean);

/** A directed script must keep the narration's words, in order. */
export function keepsWords(narration: string, script: string): boolean {
  return words(narration).join(" ") === words(stripSpeechTags(script)).join(" ");
}

function sceneRole(index: number, count: number): string {
  if (index === 0) return "the opening hook: grab attention, intrigue, energy";
  if (index === count - 1) return "the closing call to action: warm, confident, emphatic on the offer";
  return "a middle scene showing the product: clear, confident, upbeat";
}

/**
 * The AI acting as voice director: for xAI it marks up the narration with
 * speech tags; for OpenAI it writes delivery instructions. Falls back to the
 * plain narration if the AI changes the words.
 */
async function directVoice(sceneId: string, narration: string, seconds: number): Promise<{ text: string; instructions: string; script?: string }> {
  const { project } = useProject.getState();
  const i = project.scenes.findIndex((s) => s.id === sceneId);
  const role = sceneRole(i, project.scenes.length);
  const prevLine = project.scenes[i - 1]?.narration.trim();
  const nextLine = project.scenes[i + 1]?.narration.trim();
  const flow = [
    prevLine ? `Previous line (already spoken): ${prevLine}` : "This is the first line of the video.",
    nextLine ? `Next line: ${nextLine}` : "This is the last line of the video.",
    "Keep energy and pacing continuous with the neighbouring lines so the voiceover sounds like one take.",
  ].join("\n");
  const base = `Speak in ${project.brief.language}. Tone: ${project.brief.tone}. This is a product promo voiceover.`;
  const voice = activeVoice();
  if (voice?.expressive === false) return { text: narration, instructions: base };
  const ask = async (system: string, prompt: string) => {
    const res = await ipc.chat({ ...activeModel(), maxTokens: 2000, system, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] });
    return res.message.content.map((p) => (p.type === "text" ? p.text : "")).join("").trim().replace(/^```\w*\n?|```$/g, "").trim();
  };
  try {
    if (voice?.engine === "xai") {
      const script = await ask(
        "You are a voice director for product promo videos. You mark up voiceover lines for xAI text-to-speech. Output only the marked-up line.",
        [
          `Mark up this voiceover line so it is performed expressively, not flat. Scene role: ${role}. Overall tone: ${project.brief.tone}. Language: ${project.brief.language}.`,
          `Inline tags (insert between words): ${XAI_TAGS.inline.join(" ")}`,
          `Wrapping tags (wrap a few words): ${XAI_TAGS.wrap.map((w) => `<${w}>…</${w}>`).join(" ")}`,
          [
            "Rules:",
            "- Keep every word exactly as written and in the same order. You may change punctuation, and should: commas, question marks and exclamation marks shape pacing and intonation.",
            "- Wrapping tags work best around complete phrases (3+ words), never around a single word. Wrapping tags can be nested, e.g. <slow><soft>…</soft></slow>.",
            "- Put inline tags where the expression naturally happens and pair them with punctuation, e.g. \"Really? [laugh] That's incredible!\" or \"…, [pause] …\". Do not stack several tags together.",
            INTENSITY_RULES[voice.intensity ?? "normal"],
            `- The spoken result must fit in about ${seconds.toFixed(1)} seconds ([pause] ≈ 0.4 s, [long-pause] ≈ 0.9 s). Never wrap the whole line in one tag.`,
          ].join("\n"),
          flow,
          `Line: ${narration}`,
        ].join("\n"),
      );
      if (keepsWords(narration, script)) return { text: script, instructions: base, script };
      return { text: narration, instructions: base };
    }
    const notes = await ask(
      "You are a voice director for product promo videos. Output only the delivery instructions, one or two sentences.",
      `Write delivery instructions for a text-to-speech voice reading this line. Scene role: ${role}. Overall tone: ${project.brief.tone}. Language: ${project.brief.language}. Mention pacing, energy, which words to stress and where to pause.\n${flow}\n\nLine: ${narration}`,
    );
    const instructions = `${base} ${notes}`.trim();
    return { text: narration, instructions, script: notes };
  } catch {
    return { text: narration, instructions: base };
  }
}

/**
 * Records the scene narration. With brief.voiceFit "scene" the voiceover is
 * fitted into the scene (narration condensed by the AI, then gently sped up);
 * the scene only grows as a last resort. With "narration" the scene grows to
 * fit the voiceover.
 */
export async function generateVoice(
  sceneId: string,
  opts: { fit?: "scene" | "narration"; autoSync?: boolean } = {},
): Promise<void> {
  const { project } = useProject.getState();
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene || !scene.narration.trim()) return;
  const fitScene = (opts.fit ?? project.brief.voiceFit ?? "scene") === "scene";
  const slot = voiceSlot(scene.duration);
  const line = track(t("prod.voiceRecording", { title: scene.title }));
  let text = scene.narration;
  let path: string;
  let duration: number;
  let note = "";

  let script: string | undefined;
  const record = async (narration: string) => {
    line.progress(t("prod.voiceDirecting", { title: scene.title }));
    const directed = await directVoice(scene.id, narration, slot);
    script = directed.script;
    line.progress(t("prod.voiceRecording", { title: scene.title }));
    const name = `voice_${scene.id}_${Date.now().toString(36)}`;
    const p = await ipc.tts(project.id, name, {
      ...ttsConnection(),
      language: languageCode(project.brief.language),
      text: directed.text,
      instructions: directed.instructions,
    });
    return { path: p, duration: (await ipc.probe(p)).duration };
  };

  try {
    ({ path, duration } = await record(text));
    if (fitScene && duration > slot * REWRITE_ABOVE) {
      line.progress(t("prod.voiceCondensing", { title: scene.title }));
      text = await shortenNarration(text, slot * 0.95, project.brief.language);
      ({ path, duration } = await record(text));
      note = t("prod.voiceCondensed");
    }
    if (fitScene) {
      const tempo = fitTempo(duration, slot) ?? MAX_TEMPO;
      if (tempo > 1) {
        path = await ipc.retempo(path, tempo);
        duration = duration / tempo;
        note += (note ? ", " : "") + t("prod.voiceSpedUp", { x: tempo.toFixed(2) });
      }
    }
  } catch (e) {
    line.fail(t("prod.voiceFailed", { title: scene.title, err: errText(e) }));
    throw e;
  }

  const current = useProject.getState().project.scenes.find((s) => s.id === sceneId);
  if (!current) return;
  const voiced = { ...current, voicePath: path, voiceDuration: duration, voiceText: text, narration: text };
  const newDuration = current.durationLocked ? current.duration : fitDuration(voiced);
  if (fitScene && newDuration > current.duration + 0.05) note += (note ? ", " : "") + t("prod.voiceSceneExtended", { dur: newDuration.toFixed(1) });
  useProject.getState().updateScene(sceneId, { narration: text, voicePath: path, voiceDuration: duration, voiceText: text, voiceScript: script, duration: newDuration });
  line.done(t("prod.voiceReady", { title: scene.title, dur: duration.toFixed(1) }) + (note ? ` · ${note}` : ""));
  // The scene got longer than its animation was made for: let the AI retime it.
  if (opts.autoSync !== false && current.html && newDuration > current.duration + 0.05) await syncSceneWithAI(sceneId);
}

async function research(log: Log, signal: { cancelled: boolean }): Promise<Storyboard> {
  const { project } = useProject.getState();
  const ws = project.workspaceId!;
  log({ kind: "info", text: t("prod.researching") });
  const overview = await ipc.wsOverview(ws);
  let storyboard: Storyboard | null = null;
  const history: Message[] = [
    {
      role: "user",
      content: [{
        type: "text",
        text: `${overview}\n\n---\nVideo request: ${project.brief.prompt}\nTone: ${project.brief.tone}`,
      }],
    },
  ];
  const exec = async (name: string, a: ToolArgs) => {
    switch (name) {
      case "list_files":
        return (await ipc.wsListFiles(ws, String(a.dir ?? ""), typeof a.depth === "number" ? a.depth : 2)).join("\n");
      case "read_file":
        return ipc.wsReadFile(ws, String(a.path));
      case "search_code": {
        const hits = await ipc.wsSearch(ws, String(a.query));
        return hits.length ? hits.join("\n") : "No results.";
      }
      case "submit_storyboard": {
        const sb = a as unknown as Storyboard;
        if (!Array.isArray(sb.scenes) || sb.scenes.length === 0) throw new Error("scenes must not be empty");
        storyboard = sb;
        return "Storyboard accepted.";
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  };
  const reason = await runToolLoop({
    system: producerSystem(project.brief.language, project.brief.tone, project.brief.targetDuration, project.width, project.height),
    history,
    tools: RESEARCH_TOOLS,
    exec,
    maxSteps: 24,
    signal,
    done: () => storyboard !== null,
    onTool: (name, input, _r, isError) => {
      const arg = String(input.path ?? input.query ?? input.dir ?? "");
      if (name !== "submit_storyboard") log({ kind: isError ? "error" : "tool", text: `${name} ${arg}`.trim() });
    },
  });
  if (!storyboard) throw new Error(reason === "cancelled" ? t("prod.cancelled") : t("prod.noStoryboard", { reason }));
  return storyboard;
}

export async function produceVideo(log: Log, signal: { cancelled: boolean }): Promise<void> {
  const start = useProject.getState().project;
  if (!start.workspaceId) throw new Error(t("prod.noWorkspace"));
  if (!start.brief.prompt.trim()) throw new Error(t("prod.noPrompt"));

  const sb: Storyboard = await research(log, signal);
  log({ kind: "info", text: t("prod.storyboard", { n: sb.scenes.length, product: sb.product_name }) });

  // Pull referenced images out of the workspace.
  const ws = start.workspaceId;
  const loaded = new Set<string>();
  const wanted = [sb.logo_path, ...sb.scenes.flatMap((s) => s.images ?? [])].filter((p): p is string => !!p);
  for (const path of [...new Set(wanted)]) {
    if (signal.cancelled) throw new Error(t("prod.cancelled"));
    try {
      useImages.getState().put(path, await ipc.wsImage(ws, path));
      loaded.add(path);
    } catch (e) {
      log({ kind: "error", text: t("prod.imageSkipped", { path, err: errText(e) }) });
    }
  }

  const style: StyleGuide = {
    productName: sb.product_name,
    tagline: sb.tagline,
    summary: sb.summary,
    palette: sb.style?.palette ?? [],
    fontFamily: sb.style?.font_family ?? "Inter, -apple-system, Helvetica, Arial, sans-serif",
    mood: sb.style?.mood ?? "",
    notes: sb.style?.notes ?? "",
  };
  const scenes: Scene[] = sb.scenes.map((s) => {
    const refs: Record<string, string> = {};
    if (sb.logo_path && loaded.has(sb.logo_path)) refs.logo = sb.logo_path;
    (s.images ?? []).filter((p) => loaded.has(p)).forEach((p, i) => (refs[`image${i + 1}`] = p));
    return {
      id: newId("scn"),
      title: s.title,
      narration: s.narration,
      visual: s.visual,
      duration: Math.min(20, Math.max(2, Number(s.duration) || 5)),
      html: "",
      status: "pending",
      assetRefs: refs,
    };
  });
  useProject.getState().update((p) => void (p.style = style));
  useProject.getState().setScenes(scenes);

  if (start.brief.voiceEnabled) {
    log({ kind: "info", text: t("prod.voicing") });
    await pool(scenes, 3, async (s) => {
      if (signal.cancelled) return;
      // Failures are already reported on the scene's own log line.
      await generateVoice(s.id).catch(() => {});
    });
  }

  log({ kind: "info", text: t("prod.designing") });
  let failed = 0;
  await pool(scenes, 3, async (s) => {
    if (signal.cancelled) return;
    await generateSceneVisual(s.id).catch(() => failed++);
  });
  if (signal.cancelled) throw new Error(t("prod.cancelled"));
  log({ kind: "done", text: failed ? t("prod.doneWithFailures", { n: failed }) : t("prod.done") });
}

/** Scenes whose voiceover is missing or no longer matches the narration. */
export function scenesNeedingVoice(scenes: Scene[]): Scene[] {
  return scenes.filter((s) => s.narration.trim() && (!s.voicePath || s.voiceText !== s.narration));
}

/** Records voiceovers for every scene that needs one (or, with `all`, every scene with narration); returns how many failed. */
export async function generateMissingVoices(all = false): Promise<number> {
  const store = useProject.getState();
  store.update((p) => void (p.brief.voiceEnabled = true));
  let failed = 0;
  const targets = all ? store.project.scenes.filter((s) => s.narration.trim()) : scenesNeedingVoice(store.project.scenes);
  await pool(targets, 3, async (s) => {
    await generateVoice(s.id).catch(() => failed++);
  });
  return failed;
}

/** Narration sentences with estimated spoken times, so the AI can cue visuals to them. */
export function narrationCues(narration: string, voiceStart: number, voiceDuration: number): string {
  const sentences = narration.match(/[^.!?。！？]+[.!?。！？]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [narration];
  const total = sentences.reduce((a, x) => a + x.length, 0) || 1;
  let at = voiceStart;
  return sentences
    .map((x) => {
      const start = at;
      at += (x.length / total) * voiceDuration;
      return `- ${start.toFixed(1)}s–${at.toFixed(1)}s: "${x}"`;
    })
    .join("\n");
}

/**
 * Sync with AI: the scene takes its voiceover's length, then the AI retimes
 * the scene's HTML for that length, cueing elements to the narration and
 * placing the exit after it. The design itself stays the same.
 */
export async function syncSceneWithAI(sceneId: string, opts: { keepDuration?: boolean } = {}): Promise<void> {
  const s = useProject.getState().project.scenes.find((x) => x.id === sceneId);
  if (!s?.html || (!s.voiceDuration && !opts.keepDuration)) return;
  const keep = opts.keepDuration || s.durationLocked || !s.voiceDuration;
  const duration = keep ? s.duration : exactFit(s.voiceDuration!);
  if (Math.abs(duration - s.duration) > 0.01) useProject.getState().updateScene(s.id, { duration });
  const voiceEnd = s.voiceDuration ? Math.min(VOICE_LEAD + s.voiceDuration, duration) : 0;
  const exit = Math.max(voiceEnd + 0.1, duration - 0.4);
  const instruction = [
    `Retime this scene for a total duration of ${duration.toFixed(1)} seconds. Keep the visual design, layout, texts and styling exactly as they are; only change animation timing.`,
    ...(s.voiceDuration ? ["Use the narration timing given above (it already reflects the new duration)."] : []),
    `Rules: finish the entrance by about 0.8s; reveal each element close to when the narration mentions it; keep every element fully visible until ${exit.toFixed(2)}s; play the exit from ${exit.toFixed(2)}s to ${duration.toFixed(1)}s; no tween may run past ${duration.toFixed(1)}s.`,
  ].join("\n");
  await generateSceneVisual(s.id, instruction);
}

/**
 * The user resized a scene: the length is locked and the AI retimes the
 * animation for it. The voiceover is left alone; re-recording it is the
 * user's call (it then fits the locked length).
 */
export async function reviseSceneDuration(sceneId: string, duration: number): Promise<void> {
  const s = useProject.getState().project.scenes.find((x) => x.id === sceneId);
  if (!s) return;
  const target = Math.max(1.5, Math.round(duration * 10) / 10);
  if (Math.abs(target - s.duration) < 0.05) return;
  useProject.getState().updateScene(sceneId, { duration: target, durationLocked: true });
  if (!s.html) return;
  const line = track(t("prod.revising", { title: s.title, dur: target.toFixed(1) }));
  try {
    await syncSceneWithAI(sceneId, { keepDuration: true });
    const final = useProject.getState().project.scenes.find((x) => x.id === sceneId);
    line.done(t("prod.revised", { title: s.title, dur: (final?.duration ?? target).toFixed(1) }));
  } catch (e) {
    line.fail(t("prod.sceneFailed", { title: s.title, err: errText(e) }));
    throw e;
  }
}

/** Copies a scene (with its voiceover) right after the original. */
export function duplicateScene(sceneId: string): void {
  const store = useProject.getState();
  const i = store.project.scenes.findIndex((s) => s.id === sceneId);
  if (i < 0) return;
  const scenes = [...store.project.scenes];
  scenes.splice(i + 1, 0, { ...structuredClone(scenes[i]), id: newId("scn") });
  store.setScenes(scenes);
}

/** Removes a scene's voiceover (the recording stays in the project's Media). */
export function removeVoice(sceneId: string): void {
  useProject.getState().updateScene(sceneId, { voicePath: undefined, voiceDuration: undefined, voiceText: undefined });
}

/** Syncs every voiced scene with AI. */
export async function syncWithAI(): Promise<{ synced: number; failed: number }> {
  const result = { synced: 0, failed: 0 };
  const scenes = useProject.getState().project.scenes.filter((s) => s.voiceDuration && s.html);
  await pool(scenes, 3, async (s) => {
    try {
      await syncSceneWithAI(s.id);
      result.synced++;
    } catch {
      result.failed++;
    }
  });
  return result;
}
