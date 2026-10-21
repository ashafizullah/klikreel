import { useEffect } from "react";
import { redo, undo, useProject } from "../store/project";
import { usePlayback } from "../store/playback";
import { useUi } from "../store/ui";
import { projectDuration } from "./timeline";
import { saveNow } from "./library";
import { useApp } from "../store/app";
import { notifyError } from "../store/ui";

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || !!el.closest(".monaco-editor"));
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (useApp.getState().view !== "project") return;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveNow().catch(notifyError);
        return;
      }
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        useUi.getState().toggleTerminal();
        return;
      }
      if (typing(e) || useUi.getState().dialog) return;
      const pb = usePlayback.getState();
      const { project, selectedClipId } = useProject.getState();
      const frame = 1 / project.fps;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          pb.toggle();
          break;
        case "ArrowLeft":
          pb.seek(pb.time - (e.shiftKey ? 1 : frame));
          break;
        case "ArrowRight":
          pb.seek(pb.time + (e.shiftKey ? 1 : frame));
          break;
        case "Home":
          pb.seek(0);
          break;
        case "End":
          pb.seek(projectDuration(project));
          break;
        case "Delete":
        case "Backspace":
          if (selectedClipId) useProject.getState().removeClip(selectedClipId);
          break;
        case "Escape":
          useProject.getState().select(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
