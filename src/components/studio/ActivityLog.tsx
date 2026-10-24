import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Wrench } from "lucide-react";
import { useActivity, type ActivityEntry } from "../../store/activity";
import { localizeMessage, useT } from "../../i18n";

const COLOR: Record<ActivityEntry["kind"], string> = {
  info: "text-text",
  progress: "text-accent",
  tool: "text-muted",
  error: "text-danger",
  done: "text-accent",
};

function Icon({ kind }: { kind: ActivityEntry["kind"] }) {
  const cls = "mt-0.5 shrink-0";
  if (kind === "progress") return <Loader2 size={11} className={`${cls} animate-spin`} />;
  if (kind === "error") return <AlertTriangle size={11} className={cls} />;
  if (kind === "done") return <CheckCircle2 size={11} className={cls} />;
  if (kind === "tool") return <Wrench size={11} className={cls} />;
  return <span className="w-[11px] shrink-0">›</span>;
}

/** Live log of generation and scene jobs. `onlyActive` shows running jobs only. */
export function ActivityLog({ onlyActive = false }: { onlyActive?: boolean }) {
  const t = useT();
  const all = useActivity((s) => s.entries);
  const entries = onlyActive ? all.filter((e) => e.kind === "progress") : all;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  if (entries.length === 0) {
    return onlyActive ? null : <p className="px-4 py-10 text-center text-[12px] text-muted">{t("prod.activityEmpty")}</p>;
  }
  return (
    <div className={`${onlyActive ? "max-h-28 border-t border-line" : "min-h-0 flex-1"} flex flex-col`}>
      {!onlyActive && (
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="label mb-0">{t("prod.activity")}</span>
          <button className="text-[10px] text-muted hover:text-text" onClick={() => useActivity.getState().clear()}>
            {t("prod.clearActivity")}
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 font-mono text-[11px]">
        {entries.map((e) => (
          <div key={e.id} className={`flex gap-1.5 ${COLOR[e.kind]}`}>
            <Icon kind={e.kind} />
            <span className="break-words">{localizeMessage(e.text)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
