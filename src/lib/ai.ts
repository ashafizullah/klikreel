import { activeModel } from "../store/settings";
import { useProject } from "../store/project";
import { ipc } from "./ipc";

/** Generates a new HTML Frame, or edits `existingHtml` when given. */
export function generateFrame(
  prompt: string,
  duration: number,
  existingHtml?: string | null,
  onText?: (t: string) => void,
): Promise<string> {
  const { width, height } = useProject.getState().project;
  return ipc.generateFrame({ ...activeModel(), prompt, duration, width, height, existingHtml }, onText);
}

/** Adds a generated HTML Frame clip; returns its id. */
export async function addGeneratedFrame(
  prompt: string,
  start: number,
  duration: number,
  trackId?: string,
  onText?: (t: string) => void,
): Promise<string> {
  const html = await generateFrame(prompt, duration, null, onText);
  return useProject.getState().addClip({
    source: { type: "html", html, params: {}, prompt },
    start,
    duration,
    name: shortName(prompt),
    trackId,
  });
}

export function shortName(prompt: string): string {
  const s = prompt.trim().replace(/\s+/g, " ");
  return s.length > 28 ? s.slice(0, 27) + "…" : s || "HTML Frame";
}
