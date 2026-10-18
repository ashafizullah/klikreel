import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export const fileUrl = (path: string) => convertFileSrc(path);

export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];

const MIME: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

const blobs = new Map<string, Promise<string>>();

/**
 * Loads a local media file into a blob URL. WebKit stutters when streaming
 * audio through Tauri's asset protocol; in-memory blobs play smoothly.
 * Falls back to the asset URL if the file can't be read.
 */
export function blobUrl(path: string): Promise<string> {
  let p = blobs.get(path);
  if (!p) {
    p = invoke<ArrayBuffer>("media_bytes", { path })
      .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "" })))
      .catch(() => fileUrl(path));
    blobs.set(path, p);
  }
  return p;
}

/** Releases cached blobs, e.g. when leaving a project. */
export function releaseBlobs() {
  for (const p of blobs.values()) p.then((u) => u.startsWith("blob:") && URL.revokeObjectURL(u));
  blobs.clear();
}

/** React hook: the blob URL for `path`, or undefined while loading. */
export function useBlobUrl(path: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    blobUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}
