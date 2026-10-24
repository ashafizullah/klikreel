import { lazy, Suspense, useEffect, useState } from "react";
import { TopBar } from "./components/layout/TopBar";
import { Home } from "./components/home/Home";
import { BriefPanel } from "./components/studio/BriefPanel";
import { ScenePanel } from "./components/studio/ScenePanel";
import { Preview } from "./components/preview/Preview";
import { Timeline } from "./components/timeline/Timeline";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { ExportDialog } from "./components/dialogs/ExportDialog";
import { SetupDialog } from "./components/dialogs/SetupDialog";
import { UpdateDialog } from "./components/dialogs/UpdateDialog";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { TooltipLayer } from "./components/ui/TooltipLayer";
import { useUi } from "./store/ui";
import { useApp } from "./store/app";
import { useShortcuts } from "./lib/shortcuts";
import { useT } from "./i18n";
import "./lib/mcp";

const CodeEditorDialog = lazy(() => import("./components/dialogs/CodeEditorDialog"));
const TerminalPanel = lazy(() => import("./components/terminal/TerminalPanel"));

/** Starts the shell only once the panel is first opened; it lives until the project closes. */
function TerminalSlot() {
  const visible = useUi((s) => s.terminal);
  const [started, setStarted] = useState(visible);
  useEffect(() => {
    if (visible) setStarted(true);
  }, [visible]);
  return started ? (
    <Suspense fallback={null}>
      <TerminalPanel />
    </Suspense>
  ) : null;
}

export default function App() {
  useShortcuts();
  const t = useT();
  const view = useApp((s) => s.view);
  const dialog = useUi((s) => s.dialog);
  const toast = useUi((s) => s.toast);
  return (
    <div className="flex h-full flex-col">
      {view === "home" ? (
        <ErrorBoundary name={t("panel.home")}><Home /></ErrorBoundary>
      ) : (
        <>
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <ErrorBoundary name={t("panel.brief")}><BriefPanel /></ErrorBoundary>
            <ErrorBoundary name={t("panel.preview")}><Preview /></ErrorBoundary>
            <ErrorBoundary name={t("panel.scene")}><ScenePanel /></ErrorBoundary>
          </div>
          <div className="h-[230px] shrink-0">
            <ErrorBoundary name={t("panel.timeline")}><Timeline /></ErrorBoundary>
          </div>
          <ErrorBoundary name={t("panel.terminal")}><TerminalSlot /></ErrorBoundary>
        </>
      )}
      {dialog === "settings" && <SettingsDialog />}
      {dialog === "export" && <ExportDialog />}
      {dialog === "code" && (
        <Suspense fallback={null}>
          <CodeEditorDialog />
        </Suspense>
      )}
      <SetupDialog />
      <UpdateDialog />
      <TooltipLayer />
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-[60] max-w-xl -translate-x-1/2 rounded-lg border px-4 py-2 text-[12px] whitespace-pre-wrap shadow-xl ${
            toast.kind === "error" ? "border-danger/50 bg-[#2a1512] text-danger" : "border-line bg-panel-2 text-text"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
