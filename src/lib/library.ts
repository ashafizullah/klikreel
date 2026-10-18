// Project persistence in the app library, with autosave.
import type { Project } from "../types/project";
import { emptyProject, normalizeProject, useProject } from "../store/project";
import { useImages } from "../store/images";
import { useMediaCache } from "../store/media";
import { usePlayback } from "../store/playback";
import { useApp } from "../store/app";
import { notifyError, useUi } from "../store/ui";
import { useProduction } from "../store/production";
import { useChat } from "../store/chat";
import { ipc } from "./ipc";
import { MUSIC_ASSET_ID, relayout } from "./scenes";
import { blobUrl, releaseBlobs } from "./media";
import { t, useLocale } from "../i18n";
import { DEFAULT_BRIEF } from "../types/project";

type Stored = Project & { images?: Record<string, string> };

/** Only images that some scene or clip still references. */
function usedImages(p: Project): Record<string, string> {
  const all = useImages.getState().images;
  const paths = new Set<string>();
  for (const s of p.scenes) Object.values(s.assetRefs).forEach((x) => paths.add(x));
  for (const t of p.tracks) for (const c of t.clips) if (c.source.type === "html") Object.values(c.source.assetRefs ?? {}).forEach((x) => paths.add(x));
  return Object.fromEntries([...paths].filter((x) => all[x]).map((x) => [x, all[x]]));
}

export async function saveNow(): Promise<void> {
  const { project } = useProject.getState();
  if (!project.workspaceId) return;
  const stored: Stored = { ...project, images: usedImages(project) };
  await ipc.projectStore(project.id, JSON.stringify(stored));
  useProject.getState().markSaved(project.id);
}

let timer: ReturnType<typeof setTimeout> | undefined;
useProject.subscribe((s, prev) => {
  if (s.project === prev.project || !s.dirty || !s.project.workspaceId) return;
  clearTimeout(timer);
  timer = setTimeout(() => saveNow().catch(notifyError), 800);
});

function enter(project: Project, images: Record<string, string>) {
  usePlayback.getState().pause();
  usePlayback.getState().seek(0);
  useImages.getState().replace(images);
  useChat.getState().reset();
  useProject.getState().load(project, project.id);
  useProject.temporal.getState().clear();
  releaseBlobs();
  for (const a of Object.values(project.assets)) {
    if (a.kind !== "audio" || a.id === MUSIC_ASSET_ID) useMediaCache.getState().ensure(a);
    // Warm audio into memory so playback starts without loading gaps.
    if (a.kind === "audio") void blobUrl(a.path);
  }
  useApp.getState().openProject(project.id);
}

export async function createProject(workspaceId: string, name: string, width: number, height: number) {
  const id = useLocale.getState().locale === "id";
  const brief = { ...DEFAULT_BRIEF, language: id ? "Indonesian" : "English", tone: t("brief.defaultTone") };
  const project = emptyProject({ workspaceId, name, width, height, tracks: [], brief });
  enter(project, {});
  await saveNow();
}

export async function openProject(id: string) {
  try {
    const stored = JSON.parse(await ipc.projectFetch(id)) as Stored;
    const { images = {}, ...rest } = stored;
    enter(normalizeProject(rest as Project), images);
  } catch (e) {
    notifyError(e);
  }
}

/** Whether an AI job is still writing to the open project. */
export function projectBusy(): boolean {
  const prod = useProduction.getState();
  const scenes = useProject.getState().project.scenes;
  return prod.running || Object.keys(prod.busy).length > 0 || useChat.getState().busy || scenes.some((s) => s.status === "generating");
}

export async function closeProject() {
  // Jobs write into whichever project is open, so leaving mid-job would corrupt the next one.
  if (projectBusy()) {
    useUi.getState().notify(t("top.backBusy"), "error");
    return;
  }
  clearTimeout(timer);
  if (useProject.getState().dirty) await saveNow().catch(notifyError);
  usePlayback.getState().pause();
  useApp.getState().goHome();
}

/** Sets or clears the background music file. */
export async function setMusic(path: string | null) {
  const store = useProject.getState();
  if (!path) {
    store.update((p) => {
      delete p.assets[MUSIC_ASSET_ID];
      p.brief.musicPath = undefined;
      relayout(p);
    });
    return;
  }
  const info = await ipc.probe(path);
  if (info.kind !== "audio" && !info.hasAudio) throw new Error(t("err.noAudio"));
  store.update((p) => {
    p.assets[MUSIC_ASSET_ID] = { ...info, id: MUSIC_ASSET_ID, kind: "audio" };
    p.brief.musicPath = path;
    relayout(p);
  });
  useMediaCache.getState().ensure(useProject.getState().project.assets[MUSIC_ASSET_ID]);
}
