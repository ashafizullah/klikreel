import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, FolderOpen, Loader2 } from "lucide-react";
import { useProject } from "../../store/project";
import { useUi } from "../../store/ui";
import { ipc } from "../../lib/ipc";
import { buildRenderJob } from "../../lib/renderJob";
import { projectDuration } from "../../lib/timeline";
import { formatTime } from "../../lib/time";
import { Button, Modal } from "../ui";
import { localizeMessage, useT, type Key } from "../../i18n";

const QUALITY: { label: Key; crf: number }[] = [
  { label: "export.qHigh", crf: 18 },
  { label: "export.qMedium", crf: 23 },
  { label: "export.qSmall", crf: 28 },
];

type Phase = { kind: "idle" } | { kind: "running"; status: string; ratio: number; startedAt: number } | { kind: "done"; output: string; seconds: number } | { kind: "error"; message: string };

export function ExportDialog() {
  const t = useT();
  const project = useProject((s) => s.project);
  const [crf, setCrf] = useState(18);
  const [preset, setPreset] = useState("medium");
  const [fullColor, setFullColor] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const duration = projectDuration(project);
  const running = phase.kind === "running";
  const close = () => !running && useUi.getState().open(null);

  const start = async () => {
    const output = await save({ filters: [{ name: "MP4", extensions: ["mp4"] }], defaultPath: `${project.name}.mp4` });
    if (!output) return;
    const startedAt = Date.now();
    setPhase({ kind: "running", status: t("export.preparing"), ratio: 0, startedAt });
    try {
      await ipc.renderStart(buildRenderJob(project, { output, crf, preset, fullColor }), (e) => {
        setPhase((p) => {
          if (p.kind !== "running") return p;
          if (e.type === "status") return { ...p, status: localizeMessage(e.message) };
          if (e.type === "progress") return { ...p, ratio: e.ratio };
          return p;
        });
      });
      setPhase({ kind: "done", output, seconds: (Date.now() - startedAt) / 1000 });
    } catch (e) {
      setPhase({ kind: "error", message: localizeMessage(String(e)) });
    }
  };

  return (
    <Modal title={t("export.title")} onClose={close} width={480}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-bg p-3 text-center text-[12px]">
          <div><div className="text-muted">{t("export.resolution")}</div>{project.width}×{project.height}</div>
          <div><div className="text-muted">{t("export.fps")}</div>{project.fps}</div>
          <div><div className="text-muted">{t("export.duration")}</div>{formatTime(duration)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">{t("export.quality")}</span>
            <select className="field" value={crf} onChange={(e) => setCrf(+e.target.value)} disabled={running}>
              {QUALITY.map((q) => <option key={q.crf} value={q.crf}>{t(q.label)} (CRF {q.crf})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">{t("export.speed")}</span>
            <select className="field" value={preset} onChange={(e) => setPreset(e.target.value)} disabled={running}>
              <option value="veryfast">{t("export.fast")}</option>
              <option value="medium">{t("export.balanced")}</option>
              <option value="slow">{t("export.slow")}</option>
            </select>
          </label>
        </div>
        <label className="flex items-start gap-2 rounded-md border border-line p-2 text-[12px]">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={fullColor} disabled={running} onChange={(e) => setFullColor(e.target.checked)} />
          <span>
            <span className="font-medium">{t("export.fullColor")}</span>
            <span className="mt-0.5 block text-[11px] text-muted">{t("export.fullColorHint")}</span>
          </span>
        </label>

        {phase.kind === "running" && (
          <div>
            <div className="mb-1 flex justify-between text-[12px]">
              <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> {phase.status}</span>
              <span className="tabular-nums">{Math.round(phase.ratio * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${phase.ratio * 100}%` }} />
            </div>
          </div>
        )}
        {phase.kind === "done" && (
          <div className="flex items-center justify-between rounded-lg border border-accent/40 bg-accent/10 p-3 text-[12px]">
            <span className="flex items-center gap-2"><CheckCircle2 size={15} className="text-accent" /> {t("export.doneIn", { s: phase.seconds.toFixed(1) })}</span>
            <Button onClick={() => revealItemInDir(phase.output)}><FolderOpen size={13} /> {t("export.reveal")}</Button>
          </div>
        )}
        {phase.kind === "error" && (
          <pre className="max-h-40 overflow-auto rounded-lg border border-danger/40 bg-danger/10 p-3 text-[11px] whitespace-pre-wrap text-danger">{phase.message}</pre>
        )}

        <div className="flex justify-end gap-2">
          {running ? (
            <Button variant="danger" onClick={() => ipc.renderCancel()}>{t("export.cancel")}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>{t("common.close")}</Button>
              <Button variant="primary" onClick={start} disabled={duration <= 0}>{t("export.start")}</Button>
            </>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-muted">
          {t("export.note")}
        </p>
      </div>
    </Modal>
  );
}
