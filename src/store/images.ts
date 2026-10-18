// Workspace images (logo, screenshots) as data URIs, keyed by workspace path.
// Kept out of the undoable project state because they are large.
import { create } from "zustand";

interface ImageState {
  images: Record<string, string>;
  put(path: string, dataUri: string): void;
  replace(all: Record<string, string>): void;
}

export const useImages = create<ImageState>()((set) => ({
  images: {},
  put: (path, dataUri) => set((s) => ({ images: { ...s.images, [path]: dataUri } })),
  replace: (images) => set({ images }),
}));

/** name → data URI for a frame's asset references. */
export function resolveAssets(refs: Record<string, string> | undefined, images = useImages.getState().images): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, path] of Object.entries(refs ?? {})) if (images[path]) out[name] = images[path];
  return out;
}
