import { useEffect, useRef, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { Bot, Loader2, AudioLines, Music, RotateCcw, Send, Sparkles, Square, Wrench, X } from "lucide-react";
import type { Brief } from "../../types/project";
import { useProject } from "../../store/project";
import { useProduction } from "../../store/production";
import { useChat } from "../../store/chat";
import { useSettings } from "../../store/settings";
import { useUi, type StudioTab } from "../../store/ui";
import { useActivity } from "../../store/activity";
import { notifyError } from "../../store/ui";
import { setMusic } from "../../lib/library";
import { runAgent } from "../../lib/agent";
import { AUDIO_EXTENSIONS } from "../../lib/media";
import type { Message } from "../../lib/ipc";
import { Button, Slider } from "../ui";
import { ModelPicker } from "../ui/ModelPicker";
import { ActivityLog } from "./ActivityLog";
import { MediaPanel } from "./MediaPanel";
import { scenesNeedingVoice } from "../../lib/producer";
import { useT, localizeMessage, type Key } from "../../i18n";

const TABS: { id: StudioTab; label: Key }[] = [
  { id: "create", label: "brief.tabCreate" },
  { id: "revise", label: "brief.tabRevise" },
  { id: "media", label: "brief.tabMedia" },
  { id: "activity", label: "brief.tabActivity" },
];

export function BriefPanel() {
  const t = useT();
  const tab = useUi((s) => s.studioTab);
  const setTab = useUi((s) => s.setStudioTab);
  const hasScenes = useProject((s) => s.project.scenes.length > 0);
  return (
    <div className="flex w-[340px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-10 shrink-0 border-b border-line">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            disabled={(id === "revise" || id === "media") && !hasScenes}
            className={`flex flex-1 items-center justify-center gap-1 text-[12px] font-medium disabled:opacity-40 ${tab === id ? "border-b-2 border-accent text-text" : "text-muted hover:text-text"}`}
          >
            {t(label)}
            {id === "activity" && <ActivityBadge />}
          </button>
        ))}
      </div>
      {tab === "create" ? <CreateTab /> : tab === "revise" ? <ReviseTab /> : tab === "media" ? <MediaPanel /> : <ActivityTab />}
    </div>
  );
}

/** Spinner while jobs run; red dot for errors not seen yet. */
function ActivityBadge() {
  const t = useT();
  const running = useProduction((s) => s.running || Object.keys(s.busy).length > 0);
  const active = useActivity((s) => s.entries.some((e) => e.kind === "progress"));
  const unseenError = useActivity((s) => s.entries.slice(s.seen).some((e) => e.kind === "error"));
  if (running || active) return <Loader2 size={11} className="animate-spin text-accent" />;
  if (unseenError) return <span className="h-1.5 w-1.5 rounded-full bg-danger" title={t("brief.activityErrors")} />;
  return null;
}

function ActivityTab() {
  const entries = useActivity((s) => s.entries.length);
  // Everything shown here counts as seen.
  useEffect(() => {
    useActivity.getState().markSeen();
  }, [entries]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ActivityLog />
    </div>
  );
}

function CreateTab() {
  const t = useT();
  const brief = useProject((s) => s.project.brief);
  const sceneCount = useProject((s) => s.project.scenes.length);
  const musicAsset = useProject((s) => s.project.assets["ast_music"]);
  const { running, start, cancel, voiceAll } = useProduction();
  const scenes = useProject((s) => s.project.scenes);
  const needVoice = scenesNeedingVoice(scenes).length;
  const voiced = scenes.filter((s) => s.voicePath).length;
  const regenerateAllVoices = async () => {
    if (await ask(t("brief.voiceRegenAllConfirm", { n: scenes.filter((s) => s.narration.trim()).length }), { title: t("brief.voiceRegenAll"), kind: "warning" })) voiceAll(true);
  };
  const voices = useSettings((s) => s.voiceProfiles);
  const activeVoiceId = useSettings((s) => s.activeVoiceId);
  const set = (patch: Partial<Brief>) => useProject.getState().update((p) => void Object.assign(p.brief, patch));

  const generate = async () => {
    if (sceneCount > 0 && !(await ask(t("brief.regenerateConfirm"), { title: t("brief.regenerateTitle"), kind: "warning" }))) return;
    useUi.getState().setStudioTab("activity");
    start();
  };

  const pickMusic = async () => {
    const path = await open({ multiple: false, filters: [{ name: t("brief.audioFiles"), extensions: AUDIO_EXTENSIONS }] });
    if (path && !Array.isArray(path)) setMusic(path).catch(notifyError);
  };

  const musicVolume = (v: number) =>
    useProject.getState().update((p) => {
      p.brief.musicVolume = v;
      const clip = p.tracks.find((t) => t.role === "music")?.clips[0];
      if (clip) clip.volume = v;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 overflow-y-auto p-3">
        <ModelPicker />
        <label className="block">
          <span className="label">{t("brief.prompt")}</span>
          <textarea
            className="field h-32 resize-none leading-relaxed"
            placeholder={t("brief.promptPlaceholder")}
            value={brief.prompt}
            disabled={running}
            onChange={(e) => set({ prompt: e.target.value })}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">{t("brief.targetDuration")}</span>
            <select className="field" value={brief.targetDuration} disabled={running} onChange={(e) => set({ targetDuration: +e.target.value })}>
              {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{t("common.secondsLong", { n: d })}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">{t("brief.narrationLanguage")}</span>
            <input className="field" value={brief.language} disabled={running} onChange={(e) => set({ language: e.target.value })} />
          </label>
        </div>
        <label className="block">
          <span className="label">{t("brief.tone")}</span>
          <input className="field" value={brief.tone} disabled={running} onChange={(e) => set({ tone: e.target.value })} />
        </label>
        <div className="flex items-center gap-2 text-[12px]">
          <label className="flex shrink-0 items-center gap-2">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={brief.voiceEnabled} disabled={running} onChange={(e) => set({ voiceEnabled: e.target.checked })} />
            {t("brief.voiceover")}
          </label>
          {voices.length ? (
            <select
              className="field min-w-0 flex-1 py-1"
              value={activeVoiceId}
              disabled={running || !brief.voiceEnabled}
              onChange={(e) => useSettings.getState().setActiveVoice(e.target.value)}
            >
              {voices.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.voice}</option>)}
            </select>
          ) : (
            <button className="text-[11px] text-accent hover:underline" onClick={() => useUi.getState().open("settings")}>{t("brief.voiceSetup")}</button>
          )}
        </div>
        {brief.voiceEnabled && (
          <label className="block">
            <span className="label">{t("brief.voiceFit")}</span>
            <select className="field" value={brief.voiceFit ?? "scene"} disabled={running} onChange={(e) => set({ voiceFit: e.target.value as Brief["voiceFit"] })}>
              <option value="scene">{t("brief.voiceFitScene")}</option>
              <option value="narration">{t("brief.voiceFitNarration")}</option>
            </select>
          </label>
        )}
        {sceneCount > 0 && (needVoice > 0 || voiced > 0) && !running && (
          <div className="space-y-1">
            <div className="flex gap-1.5">
              {needVoice > 0 && (
                <Button className="flex-1" onClick={() => voiceAll()}>
                  <AudioLines size={13} /> {t("brief.voiceAll", { n: needVoice })}
                </Button>
              )}
              {voiced > 0 && (
                <Button className="flex-1" title={t("brief.voiceRegenAllHint")} onClick={regenerateAllVoices}>
                  <RotateCcw size={13} /> {t("brief.voiceRegenAll")}
                </Button>
              )}
            </div>
            {needVoice > 0 && <p className="text-[10px] leading-snug text-muted">{t("brief.voiceAllHint")}</p>}
          </div>
        )}
        <div className="rounded-lg border border-line p-2">
          <div className="flex items-center gap-2">
            <Music size={14} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-[12px]">{musicAsset ? musicAsset.name : t("brief.noMusic")}</span>
            {musicAsset ? (
              <button className="text-muted hover:text-danger" title={t("brief.removeMusic")} onClick={() => setMusic(null)}><X size={13} /></button>
            ) : (
              <Button onClick={pickMusic}>{t("brief.pickFile")}</Button>
            )}
          </div>
          {musicAsset && <div className="mt-2"><Slider label={t("brief.musicVolume")} min={0} max={1} value={brief.musicVolume} onChange={musicVolume} format={(v) => `${Math.round(v * 100)}%`} /></div>}
        </div>
        {running ? (
          <Button variant="danger" className="w-full" onClick={cancel}><Square size={13} /> {t("brief.stop")}</Button>
        ) : (
          <Button variant="primary" className="w-full py-2" onClick={generate} disabled={!brief.prompt.trim()}>
            <Sparkles size={14} /> {t(sceneCount ? "brief.regenerate" : "brief.generate")}
          </Button>
        )}
      </div>
    </div>
  );
}

let signal = { cancelled: false };

const EXAMPLES: Key[] = ["revise.ex1", "revise.ex2", "revise.ex3", "revise.ex4"];

function ReviseTab() {
  const t = useT();
  const { items, busy } = useChat();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items, streaming]);

  const send = async (text = input) => {
    if (!text.trim() || useChat.getState().busy) return;
    const chat = useChat.getState();
    setInput("");
    chat.push({ kind: "user", text });
    const history: Message[] = [...chat.history, { role: "user", content: [{ type: "text", text }] }];
    chat.set({ busy: true, history });
    signal = { cancelled: false };
    let buf = "";
    try {
      const reason = await runAgent(
        history,
        {
          onText: (d) => setStreaming((buf += d)),
          onMessage: (m) => {
            if (m.role !== "assistant") return;
            const text = m.content.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
            if (text) useChat.getState().push({ kind: "assistant", text });
            buf = "";
            setStreaming("");
          },
          onTool: (name, input, result, isError) => useChat.getState().push({ kind: "tool", name, input, result, isError }),
        },
        signal,
      );
      if (reason === "refusal") useChat.getState().push({ kind: "error", text: t("revise.refusal") });
      if (reason === "max_tokens") useChat.getState().push({ kind: "error", text: t("revise.truncated") });
    } catch (e) {
      useChat.getState().push({ kind: "error", text: localizeMessage(String(e)) });
    } finally {
      setStreaming("");
      useChat.getState().set({ busy: false, history });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line p-2"><ModelPicker /></div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {items.length === 0 && (
          <div className="space-y-2 py-4 text-center text-[12px] text-muted">
            <Bot size={26} className="mx-auto text-accent" />
            <p>{t("revise.hint")}</p>
            {EXAMPLES.map((key) => (
              <button key={key} onClick={() => send(t(key))} className="block w-full rounded-lg border border-line px-3 py-2 text-left hover:border-accent hover:text-text">{t(key)}</button>
            ))}
          </div>
        )}
        {items.map((it, i) => {
          if (it.kind === "user") return <div key={i} className="ml-8 rounded-lg bg-accent/15 px-3 py-2 text-[12px] whitespace-pre-wrap">{it.text}</div>;
          if (it.kind === "assistant") return <div key={i} className="mr-4 rounded-lg bg-panel-2 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap">{it.text}</div>;
          if (it.kind === "error") return <div key={i} className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{it.text}</div>;
          return (
            <div key={i} className={`flex items-center gap-1.5 text-[11px] ${it.isError ? "text-danger" : "text-muted"}`} title={it.result}>
              <Wrench size={11} /> {it.name}
            </div>
          );
        })}
        {streaming && <div className="mr-4 rounded-lg bg-panel-2 px-3 py-2 text-[12px] whitespace-pre-wrap">{streaming}</div>}
        {busy && !streaming && <div className="flex items-center gap-2 text-[12px] text-muted"><Loader2 size={13} className="animate-spin" /> {t("common.working")}</div>}
        <div ref={endRef} />
      </div>
      <ActivityLog onlyActive />
      <div className="flex gap-1.5 border-t border-line p-2">
        <textarea
          className="field h-16 flex-1 resize-none"
          placeholder={t("revise.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <Button variant="danger" title={t("revise.stopAfterStep")} onClick={() => (signal.cancelled = true)}><Square size={13} /></Button>
        ) : (
          <Button variant="primary" onClick={() => send()} disabled={!input.trim()}><Send size={13} /></Button>
        )}
      </div>
    </div>
  );
}
