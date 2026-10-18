import { useEffect, useRef, useState } from "react";
import { Bot, Check, CircleDot, Loader2, Mic, Play, RefreshCw, Trash2, Zap } from "lucide-react";
import {
  PROFILE_PRESETS, TTS_ENGINES, VOICE_PRESETS, useSettings, voiceRequest,
  type AiProfile, type ApiFormat, type TtsEngine, type VoiceProfile,
} from "../../store/settings";
import { notifyError, useUi } from "../../store/ui";
import { ipc } from "../../lib/ipc";
import { suggestBaseUrl } from "../../lib/baseUrl";
import { fileUrl } from "../../lib/media";
import { Button, Modal } from "../ui";
import { LanguageToggle } from "../ui/LanguageToggle";
import { localizeMessage, useLocale, useT } from "../../i18n";

type Tab = "ai" | "voice";

export function SettingsDialog() {
  const t = useT();
  const close = () => useUi.getState().open(null);
  const [tab, setTab] = useState<Tab>("ai");
  const s = useSettings();
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const refresh = () => {
    const st = useSettings.getState();
    return ipc.apiKeysStatus([...st.profiles.map((p) => p.id), ...st.voiceProfiles.map((v) => v.id)]).then(setKeys).catch(notifyError);
  };
  useEffect(() => void refresh(), [s.profiles.length, s.voiceProfiles.length]);

  return (
    <Modal title={t("settings.title")} onClose={close} width={800}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex rounded-lg border border-line p-0.5">
          {([["ai", Bot, "settings.tabAi"], ["voice", Mic, "settings.tabVoice"]] as const).map(([id, Icon, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] ${tab === id ? "bg-panel-2 text-accent" : "text-muted hover:text-text"}`}
            >
              <Icon size={13} /> {t(label)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-muted">
          {t("settings.appLanguage")} <LanguageToggle />
        </div>
      </div>
      {tab === "ai" ? <AiTab keys={keys} refresh={refresh} /> : <VoiceTab keys={keys} refresh={refresh} />}
    </Modal>
  );
}

function ProfileList<P extends { id: string; name: string }>({
  items, activeId, selectedId, onSelect, subtitle, keys, presets, onAdd, heading,
}: {
  items: P[];
  activeId: string;
  selectedId: string;
  onSelect(id: string): void;
  subtitle(p: P): string;
  keys: Record<string, boolean>;
  presets: string[];
  onAdd(preset: string): void;
  heading: string;
}) {
  const t = useT();
  return (
    <div className="space-y-1">
      <div className="label">{heading}</div>
      {items.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${selectedId === p.id ? "bg-panel-2" : "hover:bg-panel-2/60"}`}
        >
          <CircleDot size={12} className={activeId === p.id ? "text-accent" : "text-transparent"} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{p.name}</span>
            <span className="block truncate text-[10px] text-muted">{subtitle(p)}</span>
          </span>
          {keys[p.id] && <Check size={12} className="text-accent" />}
        </button>
      ))}
      <select className="field mt-2" value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
        <option value="">{t("settings.addProfile")}</option>
        {presets.map((label) => <option key={label} value={label}>{label}</option>)}
      </select>
    </div>
  );
}

function BaseUrlField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange(v: string): void }) {
  const t = useT();
  const fix = suggestBaseUrl(value);
  return (
    <label className="block">
      <span className="label">{t("settings.baseUrl")}</span>
      <input className="field" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {fix && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
          <span>{t("settings.baseUrlInvalid")}</span>
          <button className="rounded bg-danger/20 px-1.5 py-0.5 font-medium hover:bg-danger/30" onClick={() => onChange(fix)}>
            {t("settings.baseUrlUse", { url: fix })}
          </button>
        </div>
      )}
    </label>
  );
}

function KeyField({ id, hasKey, onChange }: { id: string; hasKey: boolean; onChange(): void }) {
  const t = useT();
  const [key, setKey] = useState("");
  const save = async () => {
    try {
      await ipc.apiKeySet(id, key);
      setKey("");
      onChange();
      useUi.getState().notify(t("settings.keyStored"));
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <label className="block">
      <span className="label">{t("settings.apiKey")} {hasKey && <span className="text-accent normal-case">{t("settings.keySaved")}</span>}</span>
      <div className="flex gap-1.5">
        <input
          type="password"
          className="field"
          autoComplete="off"
          placeholder={hasKey ? t("settings.keyReplace") : t("settings.keyPaste")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button onClick={save} disabled={!key}>{t("common.save")}</Button>
        {hasKey && (
          <Button variant="danger" title={t("settings.deleteKey")} onClick={() => ipc.apiKeyDelete(id).then(onChange).catch(notifyError)}>
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </label>
  );
}

function TestResult({ value }: { value: string | null }) {
  const t = useT();
  if (!value || value === "run") return null;
  const ok = value === "ok";
  return (
    <div className={`rounded-md px-3 py-2 text-[11px] whitespace-pre-wrap ${ok ? "bg-accent/10 text-accent" : "bg-danger/10 text-danger"}`}>
      {ok ? t("settings.testOk") : value}
    </div>
  );
}

// ---------------------------------------------------------------- AI profiles

function AiTab({ keys, refresh }: { keys: Record<string, boolean>; refresh(): void }) {
  const t = useT();
  const s = useSettings();
  const [selected, setSelected] = useState(s.activeProfileId || s.profiles[0]?.id || "");
  const profile = s.profiles.find((p) => p.id === selected);
  return (
    <div className="grid grid-cols-[220px_1fr] gap-4">
      <ProfileList
        heading={t("settings.profiles")}
        items={s.profiles}
        activeId={s.activeProfileId}
        selectedId={selected}
        onSelect={setSelected}
        subtitle={(p) => `${t(p.format === "anthropic" ? "settings.anthropic" : "settings.openaiCompatible")} · ${p.model}`}
        keys={keys}
        presets={PROFILE_PRESETS.map((p) => p.label)}
        onAdd={(label) => setSelected(s.addProfile({ ...PROFILE_PRESETS.find((p) => p.label === label)!.profile }))}
      />
      {profile ? <AiEditor key={profile.id} profile={profile} hasKey={!!keys[profile.id]} onKeyChange={refresh} /> : <p className="text-[12px] text-muted">{t("settings.empty")}</p>}
    </div>
  );
}

function AiEditor({ profile, hasKey, onKeyChange }: { profile: AiProfile; hasKey: boolean; onKeyChange(): void }) {
  const t = useT();
  const s = useSettings();
  const [testing, setTesting] = useState<string | null>(null);
  const update = (patch: Partial<AiProfile>) => s.updateProfile(profile.id, patch);
  const active = s.activeProfileId === profile.id;

  const test = async () => {
    setTesting("run");
    try {
      const res = await ipc.chat({
        format: profile.format,
        profileId: profile.id,
        baseUrl: profile.baseUrl || null,
        model: profile.model,
        maxTokens: 512,
        messages: [{ role: "user", content: [{ type: "text", text: "Reply with the single word OK." }] }],
      });
      const text = res.message.content.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
      setTesting(text ? "ok" : t("settings.testEmpty", { reason: res.stopReason }));
    } catch (e) {
      setTesting(localizeMessage(String(e)));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-muted">{t("settings.aiIntro")}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">{t("settings.name")}</span>
          <input className="field" value={profile.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">{t("settings.format")}</span>
          <select className="field" value={profile.format} onChange={(e) => update({ format: e.target.value as ApiFormat })}>
            <option value="openai">{t("settings.openaiCompatible")}</option>
            <option value="anthropic">{t("settings.anthropic")}</option>
          </select>
        </label>
      </div>
      <BaseUrlField
        value={profile.baseUrl}
        placeholder={profile.format === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
        onChange={(baseUrl) => update({ baseUrl })}
      />
      <label className="block">
        <span className="label">{t("settings.model")}</span>
        <input className="field" value={profile.model} onChange={(e) => update({ model: e.target.value })} />
      </label>
      <KeyField id={profile.id} hasKey={hasKey} onChange={onKeyChange} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={active ? "subtle" : "primary"} disabled={active} onClick={() => s.setActive(profile.id)}>
          {t(active ? "settings.active" : "settings.makeActive")}
        </Button>
        <Button onClick={test} disabled={testing === "run"}>
          {testing === "run" ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} {t("settings.test")}
        </Button>
        <Button variant="danger" onClick={() => ipc.apiKeyDelete(profile.id).finally(() => s.removeProfile(profile.id))}>
          <Trash2 size={13} /> {t("settings.deleteProfile")}
        </Button>
      </div>
      <TestResult value={testing} />
      <p className="text-[11px] leading-relaxed text-muted">{t("settings.note")}</p>
    </div>
  );
}

// ------------------------------------------------------------- Voice profiles

function VoiceTab({ keys, refresh }: { keys: Record<string, boolean>; refresh(): void }) {
  const t = useT();
  const s = useSettings();
  const [selected, setSelected] = useState(s.activeVoiceId || s.voiceProfiles[0]?.id || "");
  const voice = s.voiceProfiles.find((v) => v.id === selected);
  return (
    <div className="grid grid-cols-[220px_1fr] gap-4">
      <ProfileList
        heading={t("settings.voiceProfiles")}
        items={s.voiceProfiles}
        activeId={s.activeVoiceId}
        selectedId={selected}
        onSelect={setSelected}
        subtitle={(v) => `${TTS_ENGINES[v.engine].label} · ${v.voice}`}
        keys={keys}
        presets={VOICE_PRESETS.map((p) => p.label)}
        onAdd={(label) => setSelected(s.addVoice({ ...VOICE_PRESETS.find((p) => p.label === label)!.profile }))}
      />
      {voice ? <VoiceEditor key={voice.id} voice={voice} hasKey={!!keys[voice.id]} onKeyChange={refresh} /> : <p className="text-[12px] text-muted">{t("settings.voiceEmpty")}</p>}
    </div>
  );
}

function VoiceEditor({ voice, hasKey, onKeyChange }: { voice: VoiceProfile; hasKey: boolean; onKeyChange(): void }) {
  const t = useT();
  const s = useSettings();
  const locale = useLocale((x) => x.locale);
  const [testing, setTesting] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const update = (patch: Partial<VoiceProfile>) => s.updateVoice(voice.id, patch);
  const active = s.activeVoiceId === voice.id;

  const test = async () => {
    setTesting("run");
    try {
      const sample = voice.engine === "xai" && voice.expressive !== false ? t("settings.voiceSampleTagged") : t("settings.voiceSample");
      const path = await ipc.ttsPreview({ ...voiceRequest(voice), text: sample, language: locale });
      setTesting("ok");
      if (audio.current) {
        audio.current.src = fileUrl(path);
        await audio.current.play().catch(() => {});
      }
    } catch (e) {
      setTesting(localizeMessage(String(e)));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-muted">{t("settings.voiceIntro")}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">{t("settings.name")}</span>
          <input className="field" value={voice.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">{t("settings.ttsEngine")}</span>
          <select
            className="field"
            value={voice.engine}
            onChange={(e) => {
              const next = e.target.value as TtsEngine;
              update({ engine: next, model: TTS_ENGINES[next].model, voice: TTS_ENGINES[next].voice });
            }}
          >
            {(Object.keys(TTS_ENGINES) as TtsEngine[]).map((k) => (
              <option key={k} value={k}>{TTS_ENGINES[k].label} ({TTS_ENGINES[k].endpoint})</option>
            ))}
          </select>
        </label>
      </div>
      <BaseUrlField
        value={voice.baseUrl}
        placeholder={voice.engine === "xai" ? "https://api.x.ai/v1" : "https://api.openai.com/v1"}
        onChange={(baseUrl) => update({ baseUrl })}
      />
      <div className="grid grid-cols-2 gap-2">
        {voice.engine === "openai" && (
          <label className="block">
            <span className="label">{t("settings.model")}</span>
            <input className="field" value={voice.model} onChange={(e) => update({ model: e.target.value })} />
          </label>
        )}
        <VoicePicker voice={voice} hasKey={hasKey} onChange={(id) => update({ voice: id })} />
        <label className="block">
          <span className="mb-1 flex justify-between">
            <span className="label mb-0">{t("settings.speed")}</span>
            <span className="text-[11px] text-muted tabular-nums">{(voice.speed ?? 1).toFixed(2)}×</span>
          </span>
          <input
            type="range"
            className="w-full accent-[var(--color-accent)]"
            min={voice.engine === "xai" ? 0.7 : 0.5}
            max={1.5}
            step={0.05}
            value={voice.speed ?? 1}
            onChange={(e) => update({ speed: parseFloat(e.target.value) })}
          />
        </label>
      </div>
      <label className="flex items-start gap-2 rounded-md border border-line p-2 text-[12px]">
        <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={voice.expressive !== false} onChange={(e) => update({ expressive: e.target.checked })} />
        <span>
          <span className="font-medium">{t("settings.expressive")}</span>
          <span className="mt-0.5 block text-[11px] text-muted">{t(voice.engine === "xai" ? "settings.expressiveXai" : "settings.expressiveOpenai")}</span>
          {voice.expressive !== false && (
            <span className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-muted">{t("settings.intensity")}</span>
              {(["subtle", "normal", "strong"] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    update({ intensity: lvl });
                  }}
                  className={`rounded border px-2 py-0.5 text-[11px] ${(voice.intensity ?? "normal") === lvl ? "border-accent text-accent" : "border-line text-muted hover:text-text"}`}
                >
                  {t(`settings.intensity_${lvl}`)}
                </button>
              ))}
            </span>
          )}
        </span>
      </label>
      <KeyField id={voice.id} hasKey={hasKey} onChange={onKeyChange} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={active ? "subtle" : "primary"} disabled={active} onClick={() => s.setActiveVoice(voice.id)}>
          {t(active ? "settings.voiceActive" : "settings.makeActive")}
        </Button>
        <Button onClick={test} disabled={testing === "run"}>
          {testing === "run" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {t("settings.testVoice")}
        </Button>
        <Button variant="danger" onClick={() => ipc.apiKeyDelete(voice.id).finally(() => s.removeVoice(voice.id))}>
          <Trash2 size={13} /> {t("settings.deleteProfile")}
        </Button>
      </div>
      <TestResult value={testing} />
      <audio ref={audio} className="hidden" />
      <p className="text-[11px] leading-relaxed text-muted">{t(voice.engine === "xai" ? "settings.ttsXaiHint" : "settings.ttsOpenaiHint")}</p>
    </div>
  );
}

const CUSTOM = "__custom__";

/** Voice dropdown: xAI voices come from the account (incl. custom voices); others use the built-in list. */
function VoicePicker({ voice, hasKey, onChange }: { voice: VoiceProfile; hasKey: boolean; onChange(id: string): void }) {
  const t = useT();
  const builtIn = TTS_ENGINES[voice.engine].voices.map((id) => ({ id, name: id }));
  const [remote, setRemote] = useState<{ id: string; name: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState(false);

  const load = () => {
    if (voice.engine !== "xai" || !hasKey) return setRemote(null);
    setLoading(true);
    ipc
      .ttsVoices(voice.id, voice.baseUrl || null)
      .then((list) => setRemote(list.length ? list : null))
      .catch(() => setRemote(null))
      .finally(() => setLoading(false));
  };
  useEffect(load, [voice.engine, voice.baseUrl, hasKey]);

  const options = remote ?? builtIn;
  const known = options.some((o) => o.id === voice.voice);
  const showInput = custom || (!known && !!voice.voice);
  const label = (o: { id: string; name: string }) => (o.name && o.name.toLowerCase() !== o.id.toLowerCase() ? `${o.name} (${o.id})` : o.id);

  return (
    <div className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label mb-0">{t("settings.voice")}</span>
        {voice.engine === "xai" && (
          <button type="button" className="flex items-center gap-1 text-[10px] text-muted hover:text-text" title={t("settings.voicesRefresh")} onClick={load}>
            {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {remote ? t("settings.voicesFromAccount", { n: remote.length }) : t("settings.voicesBuiltIn")}
          </button>
        )}
      </div>
      <select
        className="field"
        value={showInput ? CUSTOM : voice.voice}
        onChange={(e) => {
          if (e.target.value === CUSTOM) return setCustom(true);
          setCustom(false);
          onChange(e.target.value);
        }}
      >
        {options.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
        <option value={CUSTOM}>{t("settings.voiceOther")}</option>
      </select>
      {showInput && (
        <input className="field mt-1.5" placeholder={t("settings.voiceIdPlaceholder")} value={voice.voice} onChange={(e) => onChange(e.target.value.trim())} />
      )}
    </div>
  );
}
