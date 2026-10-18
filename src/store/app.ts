import { create } from "zustand";
import type { ProjectMeta, Workspace } from "../lib/ipc";
import { ipc } from "../lib/ipc";

interface AppState {
  view: "home" | "project";
  mode: "studio" | "editor";
  workspaces: Workspace[];
  workspaceId: string | null;
  projects: ProjectMeta[];
  refresh(): Promise<void>;
  selectWorkspace(id: string | null): Promise<void>;
  openProject(id: string): void;
  goHome(): void;
  setMode(m: AppState["mode"]): void;
}

export const useApp = create<AppState>()((set, get) => ({
  view: "home",
  mode: "studio",
  workspaces: [],
  workspaceId: null,
  projects: [],
  refresh: async () => {
    const workspaces = await ipc.workspaces();
    const current = get().workspaceId;
    const workspaceId = workspaces.some((w) => w.id === current) ? current : (workspaces[0]?.id ?? null);
    const projects = workspaceId ? await ipc.projects(workspaceId) : [];
    set({ workspaces, workspaceId, projects });
  },
  selectWorkspace: async (workspaceId) => {
    set({ workspaceId, projects: workspaceId ? await ipc.projects(workspaceId) : [] });
  },
  openProject: () => set({ view: "project", mode: "studio" }),
  goHome: () => {
    set({ view: "home" });
    get().refresh();
  },
  setMode: (mode) => set({ mode }),
}));
