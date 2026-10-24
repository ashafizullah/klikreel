import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Clock, Sparkles, ChevronDown, Code2, Loader2, AudioLines, Play, RefreshCw, Trash2, Wand2 } from "lucide-react";
import type { Scene } from "../../types/project";
import { useProject } from "../../store/project";
import { usePlayback } from "../../store/playback";
import { useProduction } from "../../store/production";
import { useUi } from "../../store/ui";
import { generateSceneVisual, generateVoice, reviseSceneDuration, syncSceneWithAI } from "../../lib/producer";
import { editSceneWithAI } from "../../lib/agent";
import { needsSync, sceneStarts, totalDuration, voiceTooLong } from "../../lib/scenes";
import { formatTime } from "../../lib/time";
import { NumberField } from "../ui";
import { useT, type Key } from "../../i18n";

export function ScenePanel() {
  const t = useT();
  const scenes = useProject((s) => s.project.scenes);
  const selected = useProject((s) => s.selectedClipId);
  const starts = sceneStarts(scenes);
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <span className="font-serif text-[14px] font-medium">{t("scenes.title", { n: scenes.length })}</span>
        <div className="flex items-center gap-2">
          {scenes.length > 0 && <SyncAllButton hasVoice={scenes.some((s) => s.voiceDuration)} />}
          <span className="font-mono text-[11px] text-muted">{formatTime(totalDuration(scenes))}</span>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {scenes.length === 0 && (
          <div className="px-4 py-10 text-center text-[12px] leading-relaxed text-muted">
            {t("scenes.empty")}
          </div>
        )}
        {scenes.map((s, i) => (
          <SceneCard key={s.id} scene={s} index={i} count={scenes.length} start={starts[i]} selected={selected === `clp_scene_${s.id}`} />
        ))}
      </div>
    </aside>
  );
}

function SyncAllButton({ hasVoice }: { hasVoice: boolean }) {
  const t = useT();
  const running = useProduction((s) => s.running);
  return (
    <button
      disabled={running || !hasVoice}
      title={hasVoice ? t("scenes.syncAiHint") : t("scenes.syncNeedsVoice")}
      onClick={() => useProduction.getState().syncAll()}
      className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-text disabled:opacity-40"
    >
      {running ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} className="text-accent" />} {t("scenes.syncAi")}
    </button>
  );
}

function SceneCard({ scene, index, count, start, selected }: { scene: Scene; index: number; count: number; start: number; selected: boolean }) {
  const t = useT();
  const store = useProject.getState();
  const busy = useProduction((s) => s.busy[scene.id]);
  const running = useProduction((s) => s.running);
  const [open, setOpen] = useState(false);
  const [narration, setNarration] = useState(scene.narration);
  const [visual, setVisual] = useState(scene.visual);
  const [instruction, setInstruction] = useState("");
  useEffect(() => setNarration(scene.narration), [scene.narration]);
  useEffect(() => setVisual(scene.visual), [scene.visual]);

  const generating = scene.status === "generating" || scene.status === "pending" || !!busy;
  const voiceStale = !!scene.voicePath && scene.voiceText !== scene.narration;
  const job = (label: Key, fn: () => Promise<void>) => useProduction.getState().sceneJob(scene.id, label, fn);
  const focus = () => {
    usePlayback.getState().pause();
    usePlayback.getState().seek(start + 0.01);
    store.select(`clp_scene_${scene.id}`);
  };

  return (
    <div className={`rounded-lg border bg-panel-2 ${selected ? "border-accent" : "border-line"}`}>
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg font-mono text-[10px] font-medium text-accent" title={t("scenes.number", { n: index + 1 })}>{index + 1}</span>
        <input className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold outline-none" value={scene.title} onChange={(e) => store.updateScene(scene.id, { title: e.target.value })} />
        {!generating && needsSync(scene) && (
          <button
            className="flex shrink-0 items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/25 disabled:opacity-40"
            title={t("scenes.syncAiHint")}
            disabled={running}
            onClick={() => job("scenes.syncing", () => syncSceneWithAI(scene.id))}
          >
            <Sparkles size={10} /> {t("scenes.needsSync")}
          </button>
        )}
        {!generating && voiceTooLong(scene) && (
          <button
            className="flex shrink-0 items-center gap-1 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger/25 disabled:opacity-40"
            title={t("scenes.voiceTooLongHint")}
            disabled={running}
            onClick={() => job("scenes.recording", () => generateVoice(scene.id, { fit: "scene" }))}
          >
            <AudioLines size={10} /> {t("scenes.voiceTooLong")}
          </button>
        )}
        {generating ? (
          <span className="flex items-center gap-1 text-[10px] text-accent" title={busy === "scenes.queued" ? t("scenes.queuedHint") : undefined}>
            {busy === "scenes.queued" ? <Clock size={11} /> : <Loader2 size={11} className="animate-spin" />}
            {t((busy as Key | undefined) ?? "scenes.generating")}
          </span>
        ) : scene.status === "error" ? (
          <span className="flex items-center gap-1 text-[10px] text-danger" title={scene.error}><AlertTriangle size={11} />{t("scenes.failed")}</span>
        ) : null}
        <button className="text-muted hover:text-accent" title={t("scenes.preview")} onClick={focus}><Play size={13} /></button>
      </div>
      <div className="px-2.5 pt-1 text-[10px] text-muted">
        {t("scenes.meta", { start: formatTime(start), dur: scene.duration.toFixed(1) })}
        {scene.voiceDuration ? t("scenes.voiceMeta", { dur: scene.voiceDuration.toFixed(1) }) : ""}
      </div>
      <div className="space-y-2 p-2.5">
        <textarea
          className="field h-16 resize-none text-[11px] leading-relaxed"
          placeholder={t("scenes.narrationPlaceholder")}
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          onBlur={() => narration !== scene.narration && store.updateScene(scene.id, { narration })}
        />
        {voiceStale && !busy && (
          <button className="flex items-center gap-1 text-[11px] text-accent hover:underline" onClick={() => job("scenes.recording", () => generateVoice(scene.id))}>
            <AudioLines size={11} /> {t("scenes.voiceStale")}
          </button>
        )}
        {scene.status === "error" && scene.error && <p className="text-[11px] break-words text-danger">{scene.error}</p>}
        <div className="flex gap-1.5">
          <input
            className="field text-[11px]"
            placeholder={t("scenes.instructionPlaceholder")}
            value={instruction}
            disabled={generating || running}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && instruction.trim()) {
                const text = instruction;
                setInstruction("");
                job("scenes.editing", () => editSceneWithAI(scene.id, text));
              }
            }}
          />
          <button
            className="rounded-md border border-line px-2 text-muted hover:text-accent disabled:opacity-40"
            title={t("scenes.apply")}
            disabled={!instruction.trim() || generating || running}
            onClick={() => {
              const text = instruction;
              setInstruction("");
              job("scenes.editing", () => editSceneWithAI(scene.id, text));
            }}
          >
            <Wand2 size={13} />
          </button>
        </div>
        <button className="flex w-full items-center gap-1 text-[11px] text-muted hover:text-text" onClick={() => setOpen(!open)}>
          <ChevronDown size={12} className={open ? "" : "-rotate-90"} /> {t("scenes.details")}
        </button>
        {open && (
          <div className="space-y-2">
            <label className="block">
              <span className="label">{t("scenes.visualBrief")}</span>
              <textarea className="field h-20 resize-none text-[11px]" value={visual} onChange={(e) => setVisual(e.target.value)} onBlur={() => visual !== scene.visual && store.updateScene(scene.id, { visual })} />
            </label>
            <NumberField label={t("scenes.duration")} suffix={t("common.seconds")} min={1.5} max={60} value={scene.duration} onChange={(duration) => job("scenes.revisingLabel", () => reviseSceneDuration(scene.id, duration))} />
            {scene.voiceScript && (
              <div>
                <span className="label">{t("scenes.voiceScript")}</span>
                <p className="rounded-md bg-bg px-2 py-1.5 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted">{scene.voiceScript}</p>
              </div>
            )}
            {Object.keys(scene.assetRefs).length > 0 && <p className="text-[10px] text-muted">{t("scenes.images", { list: Object.values(scene.assetRefs).join(", ") })}</p>}
          </div>
        )}
        <div className="flex items-center gap-0.5 border-t border-line pt-2">
          <IconBtn title={t("scenes.rebuildVisual")} disabled={generating || running} onClick={() => job("scenes.generating", () => generateSceneVisual(scene.id))}><RefreshCw size={12} /></IconBtn>
          <IconBtn title={t("scenes.syncScene")} disabled={generating || running || !scene.voiceDuration || !scene.html} onClick={() => job("scenes.syncing", () => syncSceneWithAI(scene.id))}><Sparkles size={12} /></IconBtn>
          <IconBtn title={t("scenes.rerecordVoice")} disabled={generating || running || !scene.narration.trim()} onClick={() => job("scenes.recording", () => generateVoice(scene.id))}><AudioLines size={12} /></IconBtn>
          <IconBtn title={t("scenes.editCode")} disabled={!scene.html} onClick={() => { focus(); useUi.getState().open("code"); }}><Code2 size={12} /></IconBtn>
          <div className="flex-1" />
          <IconBtn title={t("scenes.moveUp")} disabled={index === 0} onClick={() => store.moveScene(scene.id, index - 1)}><ArrowUp size={12} /></IconBtn>
          <IconBtn title={t("scenes.moveDown")} disabled={index === count - 1} onClick={() => store.moveScene(scene.id, index + 1)}><ArrowDown size={12} /></IconBtn>
          <IconBtn title={t("scenes.delete")} disabled={running} onClick={() => store.removeScene(scene.id)}><Trash2 size={12} /></IconBtn>
        </div>
      </div>
    </div>
  );
}

function IconBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="rounded p-1.5 text-muted hover:bg-bg hover:text-text disabled:opacity-30" {...props} />;
}
