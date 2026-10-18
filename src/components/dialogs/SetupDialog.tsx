// Shown at launch when ffmpeg or a Chromium-based browser is missing, with
// the command that installs it (Homebrew on macOS).
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Terminal } from "lucide-react";
import { Button, Modal } from "../ui";
import { ipc, type SystemStatus } from "../../lib/ipc";
import { useT } from "../../i18n";
import { notifyError, useUi } from "../../store/ui";

const missing = (s: SystemStatus) => ({ ffmpeg: !s.ffmpeg || !s.ffprobe, chrome: !s.chrome });

function InstallStep({ what, title, body, command, status }: {
  what: "ffmpeg" | "chrome";
  title: string;
  body: string;
  command: string;
  status: SystemStatus;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const mac = status.os === "macos";
  const noBrew = mac && command.includes("Homebrew/install");
  const site = what === "ffmpeg" ? "https://ffmpeg.org/download.html" : "https://www.google.com/chrome/";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      useUi.getState().notify(t("setup.copied"));
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      notifyError(e);
    }
  };
  const run = async () => {
    try {
      await ipc.installInTerminal(what);
      useUi.getState().notify(t("setup.terminalOpened"));
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3">
      <div className="text-[13px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[12px] text-muted">{body}</div>
      <div className="mt-2.5 text-[12px]">
        {mac ? t(noBrew ? "setup.brewMissingHint" : "setup.brewHint") : t("setup.otherHint")}
      </div>
      <pre className="mt-1.5 overflow-x-auto rounded-md border border-line bg-black/40 px-2.5 py-2 font-mono text-[11.5px] whitespace-pre-wrap break-all select-text">
        {command}
      </pre>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={copy}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {t("setup.copy")}
        </Button>
        {mac && (
          <Button variant="primary" onClick={run}>
            <Terminal size={13} /> {t("setup.runInTerminal")}
          </Button>
        )}
        {!mac && (
          <a className="self-center text-[12px] text-accent hover:underline" href={site} target="_blank" rel="noreferrer">
            {site.replace(/^https:\/\//, "")}
          </a>
        )}
      </div>
    </div>
  );
}

export function SetupDialog() {
  const t = useT();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    ipc.systemStatus()
      .then((s) => {
        setStatus(s);
        const m = missing(s);
        setOpen(m.ffmpeg || m.chrome);
      })
      .catch(() => {});
  }, []);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      const s = await ipc.systemStatus();
      setStatus(s);
      const m = missing(s);
      if (m.ffmpeg || m.chrome) {
        useUi.getState().notify(t("setup.stillMissing"), "error");
      } else {
        useUi.getState().notify(t("setup.ready"));
        setOpen(false);
      }
    } catch (e) {
      notifyError(e);
    } finally {
      setChecking(false);
    }
  }, [t]);

  if (!open || !status) return null;
  const m = missing(status);
  return (
    <Modal title={t("setup.title")} onClose={() => setOpen(false)} width={580}>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">{t("setup.intro")}</p>
      <div className="space-y-3">
        {m.ffmpeg && status.ffmpegInstall && (
          <InstallStep what="ffmpeg" title={t("setup.ffmpegTitle")} body={t("setup.ffmpegBody")} command={status.ffmpegInstall} status={status} />
        )}
        {m.chrome && status.chromeInstall && (
          <InstallStep what="chrome" title={t("setup.chromeTitle")} body={t("setup.chromeBody")} command={status.chromeInstall} status={status} />
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>{t("setup.later")}</Button>
        <Button onClick={recheck} disabled={checking}>
          <RefreshCw size={13} className={checking ? "animate-spin" : ""} /> {t("setup.checkAgain")}
        </Button>
      </div>
    </Modal>
  );
}
