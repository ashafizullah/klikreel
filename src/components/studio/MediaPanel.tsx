import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, AudioLines, Music, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import type { Scene } from "../../types/project";
import { useProject } from "../../store/project";
import { notifyError } from "../../store/ui";
import { ipc } from "../../lib/ipc";
import { blobUrl } from "../../lib/media";
import { MUSIC_ASSET_ID } from "../../lib/scenes";
import { formatMB, formatTime } from "../../lib/time";
import { useT } from "../../i18n";

type MediaFile = { path: string; name: string; size: number; modified: number };

/** Audio the AI generated for this project: voiceovers in use, older takes, and the music. */
export function MediaPanel() {
  const t = useT();
  const projectId = useProject((s) => s.project.id);
  const scenes = useProject((s) => s.project.scenes);
  const music = useProject((s) => s.project.assets[MUSIC_ASSET_ID]);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [musicSize, setMusicSize] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  const refresh = () => ipc.projectMedia(projectId).then(setFiles).catch(notifyError);
  useEffect(() => {
    if (music) ipc.fileSizes([music.path]).then(([n]) => setMusicSize(n)).catch(() => setMusicSize(0));
  }, [music?.path]);
  useEffect(() => {
    refresh();
  }, [projectId, scenes.map((s) => s.voicePath).join("|")]);

  const toggle = async (path: string) => {
    const el = audio.current;
    if (!el) return;
    if (playing === path) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.src = await blobUrl(path);
    el.play().catch(notifyError);
    setPlaying(path);
  };

  const used = new Set(scenes.map((s) => s.voicePath).filter(Boolean));
  const takes = files.filter((f) => !used.has(f.path));
  const sizeOf = (path: string) => files.find((f) => f.path === path)?.size ?? 0;
  const generatedTotal = files.reduce((a, f) => a + f.size, 0);
  const takesTotal = takes.reduce((a, f) => a + f.size, 0);

  const useTake = async (file: MediaFile, sceneId: string) => {
    try {
      const info = await ipc.probe(file.path);
      const scene = useProject.getState().project.scenes.find((s) => s.id === sceneId);
      useProject.getState().updateScene(sceneId, { voicePath: file.path, voiceDuration: info.duration, voiceText: scene?.narration });
    } catch (e) {
      notifyError(e);
    }
  };

  const remove = async (file: MediaFile) => {
    if (!(await ask(t("media.deleteConfirm", { name: file.name }), { title: t("common.delete"), kind: "warning" }))) return;
    await ipc.projectMediaDelete(projectId, file.name).catch(notifyError);
    refresh();
  };

  const voiced = scenes.filter((s) => s.voicePath);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <audio ref={audio} className="hidden" onEnded={() => setPlaying(null)} />
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[11px] text-muted">
          {t("media.intro")} · <span className="text-text">{formatMB(generatedTotal + musicSize)}</span>
        </span>
        <div className="flex gap-1">
          <button className="rounded p-1 text-muted hover:text-text" title={t("media.refresh")} onClick={refresh}><RefreshCw size={13} /></button>
          {files[0] && (
            <button className="rounded p-1 text-muted hover:text-text" title={t("menu.reveal")} onClick={() => revealItemInDir(files[0].path).catch(notifyError)}>
              <FolderOpen size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <section>
          <h3 className="label">{t("media.inUse")}</h3>
          {voiced.length === 0 && !music && <p className="text-[11px] text-muted">{t("media.none")}</p>}
          <div className="space-y-1">
            {voiced.map((s) => (
              <Row
                key={s.id}
                icon={<AudioLines size={12} />}
                title={`${scenes.indexOf(s) + 1}. ${s.title}`}
                detail={`${formatTime(s.voiceDuration ?? 0)} · ${formatMB(sizeOf(s.voicePath!))} · ${s.voicePath!.split("/").pop()}`}
                playing={playing === s.voicePath}
                onPlay={() => toggle(s.voicePath!)}
                onReveal={() => revealItemInDir(s.voicePath!).catch(notifyError)}
              />
            ))}
            {music && (
              <Row
                icon={<Music size={12} />}
                title={t("track.music")}
                detail={`${formatTime(music.duration)} · ${formatMB(musicSize)} · ${music.name}`}
                playing={playing === music.path}
                onPlay={() => toggle(music.path)}
                onReveal={() => revealItemInDir(music.path).catch(notifyError)}
              />
            )}
          </div>
        </section>
        {takes.length > 0 && (
          <section>
            <h3 className="label">{t("media.otherTakes")} · {formatMB(takesTotal)}</h3>
            <p className="mb-2 text-[11px] text-muted">{t("media.otherTakesHint")}</p>
            <div className="space-y-1">
              {takes.map((f) => (
                <Row
                  key={f.path}
                  icon={<AudioLines size={12} className="text-muted" />}
                  title={f.name}
                  detail={`${formatMB(f.size)} · ${new Date(f.modified).toLocaleString()}`}
                  playing={playing === f.path}
                  onPlay={() => toggle(f.path)}
                  onReveal={() => revealItemInDir(f.path).catch(notifyError)}
                  onDelete={() => remove(f)}
                  extra={<UseInScene scenes={scenes} onPick={(id) => useTake(f, id)} />}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ icon, title, detail, playing, onPlay, onReveal, onDelete, extra }: {
  icon: React.ReactNode; title: string; detail: string; playing: boolean;
  onPlay(): void; onReveal(): void; onDelete?(): void; extra?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className={`rounded-md border px-2 py-1.5 ${playing ? "border-accent bg-accent/5" : "border-line"}`}>
      <div className="flex items-center gap-2">
        <button className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-2 hover:text-accent" title={t(playing ? "media.pause" : "media.play")} onClick={onPlay}>
          {playing ? <Pause size={11} /> : <Play size={11} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 truncate text-[12px]">{icon} <span className="truncate">{title}</span></div>
          <div className="truncate text-[10px] text-muted">{detail}</div>
        </div>
        <button className="rounded p-1 text-muted hover:text-text" title={t("menu.reveal")} onClick={onReveal}><FolderOpen size={12} /></button>
        {onDelete && <button className="rounded p-1 text-muted hover:text-danger" title={t("common.delete")} onClick={onDelete}><Trash2 size={12} /></button>}
      </div>
      {extra}
    </div>
  );
}

function UseInScene({ scenes, onPick }: { scenes: Scene[]; onPick(id: string): void }) {
  const t = useT();
  return (
    <select className="field mt-1.5 py-0.5 text-[11px]" value="" onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">{t("media.useInScene")}</option>
      {scenes.map((s, i) => (
        <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>
      ))}
    </select>
  );
}
