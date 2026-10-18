import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowRight, Code2, Copy, FolderOpen, AudioLines, Music, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useProject } from "../../store/project";
import { usePlayback } from "../../store/playback";
import { useProduction } from "../../store/production";
import { notifyError, useUi } from "../../store/ui";
import { duplicateScene, generateSceneVisual, generateVoice, removeVoice, syncSceneWithAI } from "../../lib/producer";
import { setMusic } from "../../lib/library";
import { AUDIO_EXTENSIONS } from "../../lib/media";
import { findClip } from "../../lib/timeline";
import { useT } from "../../i18n";

/** Which clip the context menu is open for, and where. */
export const useClipMenu = create<{ at: { x: number; y: number; clipId: string } | null; show(x: number, y: number, clipId: string): void; hide(): void }>()(
  (set) => ({
    at: null,
    show: (x, y, clipId) => set({ at: { x, y, clipId } }),
    hide: () => set({ at: null }),
  }),
);

type Item = { icon: typeof Play; label: string; run(): void; danger?: boolean; disabled?: boolean } | "sep";

export function ClipMenu() {
  const t = useT();
  const at = useClipMenu((s) => s.at);
  const hide = useClipMenu((s) => s.hide);
  const project = useProject((s) => s.project);
  const running = useProduction((s) => s.running);
  const busy = useProduction((s) => s.busy);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      hide();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("blur", close);
    };
  }, [at, hide]);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(at.x, window.innerWidth - r.width - 8), y: Math.min(at.y, window.innerHeight - r.height - 8) });
  }, [at]);

  if (!at) return null;
  const hit = findClip(project, at.clipId);
  if (!hit) return null;
  const { clip, track } = hit;
  const store = useProject.getState();
  const scene = clip.sceneId ? project.scenes.find((s) => s.id === clip.sceneId) : undefined;
  const sceneIndex = scene ? project.scenes.indexOf(scene) : -1;
  const sceneBusy = scene ? !!busy[scene.id] || running : false;
  const job = (label: Parameters<ReturnType<typeof useProduction.getState>["sceneJob"]>[1], fn: () => Promise<void>) =>
    scene && useProduction.getState().sceneJob(scene.id, label, fn);
  const playFrom = () => {
    usePlayback.getState().seek(clip.start + 0.01);
    usePlayback.getState().play();
  };
  const reveal = (path?: string) => path && revealItemInDir(path).catch(notifyError);

  let items: Item[];
  if (scene && track.role === "scenes") {
    items = [
      { icon: Play, label: t("menu.playFrom"), run: playFrom },
      "sep",
      { icon: Sparkles, label: t("scenes.syncScene"), run: () => job("scenes.syncing", () => syncSceneWithAI(scene.id)), disabled: sceneBusy || !scene.html },
      { icon: RefreshCw, label: t("scenes.rebuildVisual"), run: () => job("scenes.generating", () => generateSceneVisual(scene.id)), disabled: sceneBusy },
      { icon: AudioLines, label: t("scenes.rerecordVoice"), run: () => job("scenes.recording", () => generateVoice(scene.id)), disabled: sceneBusy || !scene.narration.trim() },
      {
        icon: Code2,
        label: t("scenes.editCode"),
        run: () => {
          store.select(clip.id);
          useUi.getState().open("code");
        },
        disabled: !scene.html,
      },
      "sep",
      { icon: Copy, label: t("menu.duplicate"), run: () => duplicateScene(scene.id), disabled: running },
      { icon: ArrowLeft, label: t("menu.moveEarlier"), run: () => store.moveScene(scene.id, sceneIndex - 1), disabled: sceneIndex <= 0 },
      { icon: ArrowRight, label: t("menu.moveLater"), run: () => store.moveScene(scene.id, sceneIndex + 1), disabled: sceneIndex >= project.scenes.length - 1 },
      "sep",
      { icon: Trash2, label: t("scenes.delete"), run: () => store.removeScene(scene.id), danger: true, disabled: running },
    ];
  } else if (scene && track.role === "voice") {
    items = [
      { icon: Play, label: t("menu.playFrom"), run: playFrom },
      { icon: AudioLines, label: t("scenes.rerecordVoice"), run: () => job("scenes.recording", () => generateVoice(scene.id)), disabled: sceneBusy },
      { icon: FolderOpen, label: t("menu.reveal"), run: () => reveal(scene.voicePath) },
      "sep",
      { icon: Trash2, label: t("menu.removeVoice"), run: () => removeVoice(scene.id), danger: true },
    ];
  } else if (track.role === "music") {
    items = [
      { icon: Play, label: t("menu.playFrom"), run: playFrom },
      {
        icon: Music,
        label: t("menu.replaceMusic"),
        run: async () => {
          const path = await open({ multiple: false, filters: [{ name: t("brief.audioFiles"), extensions: AUDIO_EXTENSIONS }] });
          if (path && !Array.isArray(path)) setMusic(path).catch(notifyError);
        },
      },
      { icon: FolderOpen, label: t("menu.reveal"), run: () => reveal(project.brief.musicPath) },
      "sep",
      { icon: Trash2, label: t("brief.removeMusic"), run: () => setMusic(null), danger: true },
    ];
  } else {
    items = [
      { icon: Play, label: t("menu.playFrom"), run: playFrom },
      "sep",
      { icon: Trash2, label: t("common.delete"), run: () => store.removeClip(clip.id), danger: true },
    ];
  }

  return (
    <div
      ref={ref}
      className="fixed z-[70] min-w-52 rounded-lg border border-line bg-panel py-1 shadow-2xl"
      style={{ left: pos.x || at.x, top: pos.y || at.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="truncate px-3 pt-1 pb-1.5 text-[10px] text-muted">{clip.name}</div>
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              hide();
              item.run();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] disabled:opacity-35 ${item.danger ? "text-danger hover:bg-danger/10" : "hover:bg-panel-2"}`}
          >
            <item.icon size={13} className="shrink-0" /> {item.label}
          </button>
        ),
      )}
    </div>
  );
}
