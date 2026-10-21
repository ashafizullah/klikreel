import { create } from "zustand";
import { localizeMessage } from "../i18n";

export type StudioTab = "create" | "revise" | "media" | "activity";

interface UiState {
  studioTab: StudioTab;
  setStudioTab(t: StudioTab): void;
  /** Timeline zoom in pixels per second. */
  zoom: number;
  snapping: boolean;
  dialog: null | "settings" | "export" | "code";
  /** In-app terminal panel visibility. */
  terminal: boolean;
  toggleTerminal(): void;
  toast: { kind: "info" | "error"; text: string } | null;
  setZoom(z: number): void;
  toggleSnapping(): void;
  open(d: UiState["dialog"]): void;
  notify(text: string, kind?: "info" | "error"): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>()((set) => ({
  studioTab: "create",
  setStudioTab: (studioTab) => set({ studioTab }),
  zoom: 60,
  snapping: true,
  dialog: null,
  terminal: false,
  toggleTerminal: () => set((s) => ({ terminal: !s.terminal })),
  toast: null,
  setZoom: (zoom) => set({ zoom: Math.min(600, Math.max(4, zoom)) }),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  open: (dialog) => set({ dialog }),
  notify: (text, kind = "info") => {
    clearTimeout(toastTimer);
    set({ toast: { text, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), kind === "error" ? 7000 : 3500);
  },
}));

export const notifyError = (e: unknown) =>
  useUi.getState().notify(localizeMessage(e instanceof Error ? e.message : String(e)), "error");
