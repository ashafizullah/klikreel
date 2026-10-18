import { create } from "zustand";
import type { LogEntry } from "../lib/producer";
import { generateMissingVoices, produceVideo, syncWithAI } from "../lib/producer";
import { useActivity } from "./activity";
import { createLimiter } from "../lib/queue";

/** Scene jobs started from the UI (regenerate, sync, voice…): at most 3 AI jobs at once. */
const sceneQueue = createLimiter(3);
import { useProject } from "./project";
import { t, type Key } from "../i18n";

interface ProductionState {
  running: boolean;
  signal: { cancelled: boolean };
  /** Scene ids with a voice or visual job in flight from the scene panel. */
  busy: Record<string, string>;
  start(): Promise<void>;
  /** Voiceover for scenes generated without one (or with changed narration). */
  voiceAll(all?: boolean): Promise<void>;
  /** AI retimes every voiced scene to its narration. */
  syncAll(): Promise<void>;
  cancel(): void;
  setBusy(sceneId: string, label: string | null): void;
  /** Runs a job for one scene, showing `label` on its card; errors are already on the activity log. */
  sceneJob(sceneId: string, label: Key, fn: () => Promise<void>): Promise<void>;
}

export const useProduction = create<ProductionState>()((set, get) => ({
  running: false,
  signal: { cancelled: false },
  busy: {},
  start: async () => {
    if (get().running) return;
    const signal = { cancelled: false };
    set({ running: true, signal });
    useActivity.getState().clear();
    const push = (e: LogEntry) => useActivity.getState().push(e.kind, e.text);
    try {
      await produceVideo(push, signal);
    } catch (e) {
      push({ kind: "error", text: String(e instanceof Error ? e.message : e) });
      // Leave scenes that never started in a retryable state.
      for (const s of useProject.getState().project.scenes)
        if (s.status === "pending" || s.status === "generating") useProject.getState().updateScene(s.id, { status: s.html ? "ready" : "error", error: s.html ? undefined : t("scenes.stopped") });
    } finally {
      set({ running: false });
    }
  },
  voiceAll: async (all = false) => {
    if (get().running) return;
    set({ running: true });
    try {
      const failed = await generateMissingVoices(all);
      useActivity.getState().push(failed ? "error" : "done", failed ? t("prod.voicesFailed", { n: failed }) : t("prod.voicesDone"));
    } catch (e) {
      useActivity.getState().push("error", e instanceof Error ? e.message : String(e));
    } finally {
      set({ running: false });
    }
  },
  syncAll: async () => {
    if (get().running) return;
    set({ running: true });
    try {
      const r = await syncWithAI();
      useActivity.getState().push(r.failed ? "error" : "done", t("prod.syncAiDone", { n: r.synced, f: r.failed }));
    } finally {
      set({ running: false });
    }
  },
  cancel: () => {
    get().signal.cancelled = true;
  },
  sceneJob: async (sceneId, label, fn) => {
    // One job per scene; across scenes the shared queue limits parallel AI calls.
    if (get().busy[sceneId]) return;
    get().setBusy(sceneId, "scenes.queued");
    try {
      await sceneQueue.run(fn, () => get().setBusy(sceneId, label));
    } catch {
      // Reported on the activity log and the scene card.
    } finally {
      get().setBusy(sceneId, null);
    }
  },
  setBusy: (sceneId, label) =>
    set((s) => {
      const busy = { ...s.busy };
      if (label) busy[sceneId] = label;
      else delete busy[sceneId];
      return { busy };
    }),
}));
