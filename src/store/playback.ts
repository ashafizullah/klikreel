import { create } from "zustand";
import { projectDuration } from "../lib/timeline";
import { useProject } from "./project";

interface PlaybackState {
  time: number;
  playing: boolean;
  seek(t: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
}

/**
 * While audio is playing, the timeline follows the audio element instead of
 * its own wall clock, so the audio never has to be re-seeked mid-playback.
 */
type ClockSource = { id: string; read(): number | null };
let master: ClockSource | null = null;

export function claimClock(id: string, read: () => number | null) {
  if (!master || master.id === id) master = { id, read };
}

export function releaseClock(id: string) {
  if (master?.id === id) master = null;
}

export function isClockMaster(id: string) {
  return master?.id === id;
}

let raf = 0;
let last = 0;

export const usePlayback = create<PlaybackState>()((set, get) => ({
  time: 0,
  playing: false,
  seek: (t) => set({ time: Math.max(0, t) }),
  play: () => {
    const end = projectDuration(useProject.getState().project);
    if (end <= 0) return;
    if (get().time >= end - 0.01) set({ time: 0 });
    set({ playing: true });
    last = performance.now();
    const tick = (now: number) => {
      if (!get().playing) return;
      const dt = (now - last) / 1000;
      last = now;
      const duration = projectDuration(useProject.getState().project);
      const fromMedia = master?.read();
      // Trust the media clock unless it is clearly off (e.g. still starting up).
      const prev = get().time;
      const t = fromMedia != null && Math.abs(fromMedia - (prev + dt)) < 0.5 ? fromMedia : prev + dt;
      if (t >= duration) {
        set({ time: duration, playing: false });
        return;
      }
      set({ time: t });
      raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  },
  pause: () => {
    cancelAnimationFrame(raf);
    master = null;
    set({ playing: false });
  },
  toggle: () => (get().playing ? get().pause() : get().play()),
}));
