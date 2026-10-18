// Shared activity log: the full "generate video" run and individual scene
// jobs (edit, rebuild, voice) all report progress here.
import { create } from "zustand";

export type ActivityKind = "info" | "progress" | "tool" | "error" | "done";
export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  text: string;
}

let seq = 0;

interface ActivityState {
  entries: ActivityEntry[];
  /** Number of entries already seen in the Activity tab. */
  seen: number;
  markSeen(): void;
  /** Appends an entry and returns its id. */
  push(kind: ActivityKind, text: string): string;
  /** Updates an entry in place (e.g. a progress line turning into done/error). */
  update(id: string, kind: ActivityKind, text: string): void;
  clear(): void;
}

export const useActivity = create<ActivityState>()((set) => ({
  entries: [],
  seen: 0,
  markSeen: () => set((s) => ({ seen: s.entries.length })),
  push: (kind, text) => {
    const id = `act_${++seq}`;
    set((s) => {
      const kept = s.entries.slice(-300);
      return { entries: [...kept, { id, kind, text }], seen: Math.max(0, s.seen - (s.entries.length - kept.length)) };
    });
    return id;
  },
  update: (id, kind, text) => set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { id, kind, text } : e)) })),
  clear: () => set({ entries: [], seen: 0 }),
}));

/** A progress line that can be refreshed and finally resolved. */
export function track(text: string) {
  const { push, update } = useActivity.getState();
  const id = push("progress", text);
  let last = 0;
  return {
    /** Throttled live update while the job runs. */
    progress(next: string) {
      const now = performance.now();
      if (now - last < 250) return;
      last = now;
      update(id, "progress", next);
    },
    done: (next: string) => update(id, "tool", next),
    fail: (next: string) => update(id, "error", next),
  };
}
