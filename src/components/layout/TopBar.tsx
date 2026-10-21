import { ArrowLeft, Download, KeyRound, SquareTerminal } from "lucide-react";
import logo from "../../assets/logo.png";
import { useProject } from "../../store/project";
import { useUi } from "../../store/ui";
import { useApp } from "../../store/app";
import { closeProject } from "../../lib/library";
import { useT } from "../../i18n";
import { Button, IconButton } from "../ui";
import { LanguageToggle } from "../ui/LanguageToggle";
import { McpBadge } from "../terminal/McpBadge";

export function TopBar() {
  const t = useT();
  const name = useProject((s) => s.project.name);
  const dirty = useProject((s) => s.dirty);
  const wsId = useProject((s) => s.project.workspaceId);
  const ws = useApp((s) => s.workspaces.find((w) => w.id === wsId));
  const open = useUi((s) => s.open);
  const terminal = useUi((s) => s.terminal);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3" data-tauri-drag-region>
      <IconButton title={t("top.back")} onClick={closeProject}><ArrowLeft size={16} /></IconButton>
      <img src={logo} alt="" className="h-7 w-7" draggable={false} />
      <span className="truncate text-[12px] text-muted">{ws?.name ?? "Workspace"}</span>
      <span className="text-muted">/</span>
      <input
        className="w-64 rounded-md bg-transparent px-2 py-1 text-[13px] font-medium outline-none hover:bg-panel-2 focus:bg-panel-2"
        value={name}
        onChange={(e) => useProject.getState().update((p) => void (p.name = e.target.value))}
      />
      <span className="text-[11px] text-muted">{dirty ? t("top.saving") : t("top.saved")}</span>
      <div className="flex-1" />
      <McpBadge />
      <IconButton title={t("top.terminal")} active={terminal} onClick={() => useUi.getState().toggleTerminal()}><SquareTerminal size={16} /></IconButton>
      <LanguageToggle />
      <Button variant="ghost" onClick={() => open("settings")}><KeyRound size={14} /> {t("home.aiSettings")}</Button>
      <Button variant="primary" onClick={() => open("export")}><Download size={14} /> {t("top.export")}</Button>
    </header>
  );
}
