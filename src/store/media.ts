// Derived, non-undoable caches for assets: timeline thumbnails and waveforms.
import { create } from "zustand";
import type { Asset } from "../types/project";
import { ipc } from "../lib/ipc";

interface MediaCache {
  thumbs: Record<string, string[]>;
  peaks: Record<string, number[]>;
  ensure(asset: Asset): void;
}

const inflight = new Set<string>();

export const useMediaCache = create<MediaCache>()((set) => ({
  thumbs: {},
  peaks: {},
  ensure: (asset) => {
    if (inflight.has(asset.id)) return;
    inflight.add(asset.id);
    if (asset.kind !== "audio") {
      const count = asset.kind === "image" ? 1 : Math.min(30, Math.max(4, Math.ceil(asset.duration / 2)));
      ipc
        .thumbnails(asset.path, asset.duration, count, 72)
        .then((list) => set((s) => ({ thumbs: { ...s.thumbs, [asset.id]: list } })))
        .catch((e) => console.warn("thumbnails", e));
    }
    if (asset.kind === "audio" || asset.hasAudio) {
      const buckets = Math.min(8000, Math.max(200, Math.ceil(asset.duration * 50)));
      ipc
        .waveform(asset.path, buckets)
        .then((list) => set((s) => ({ peaks: { ...s.peaks, [asset.id]: list } })))
        .catch((e) => console.warn("waveform", e));
    }
  },
}));
