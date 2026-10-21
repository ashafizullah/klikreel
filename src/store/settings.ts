import { create } from "zustand";
import { persist } from "zustand/middleware";
import { newId } from "../lib/ids";
import { t } from "../i18n";
import { ipc } from "../lib/ipc";

export type ApiFormat = "openai" | "anthropic";

/** A text-model connection (research, storyboard, HTML). Its API key lives in the OS keychain under the profile id. */
export interface AiProfile {
  id: string;
  name: string;
  format: ApiFormat;
  baseUrl: string;
  model: string;
}

export type TtsEngine = "openai" | "xai";

/** A voiceover connection. Has its own API key in the keychain. */
export interface VoiceProfile {
  id: string;
  name: string;
  engine: TtsEngine;
  baseUrl: string;
  /** Only used by the OpenAI engine. */
  model: string;
  voice: string;
  /** Let the AI direct the delivery (xAI speech tags / OpenAI instructions). Defaults to on. */
  expressive?: boolean;
  /** How strongly the AI directs the delivery. Defaults to "strong". */
  intensity?: "subtle" | "normal" | "strong";
  /** Speaking rate (xAI 0.7–1.5). Defaults to 1. */
  speed?: number;
}

export const TTS_ENGINES: Record<TtsEngine, { label: string; endpoint: string; model: string; voice: string; voices: string[] }> = {
  openai: {
    label: "OpenAI-compatible",
    endpoint: "/audio/speech",
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"],
  },
  xai: {
    label: "xAI (Grok)",
    endpoint: "/tts",
    model: "",
    voice: "eve",
    voices: ["eve", "ara", "rex", "leo", "sal", "luna", "iris", "orion", "helix", "atlas", "celeste", "carina", "zagan", "altair",
      "zenith", "perseus", "helios", "lux", "kepler", "rigel", "cosmo", "ursa", "sirius", "lumen", "castor", "naksh"],
  },
};

export const PROFILE_PRESETS: { label: string; profile: Omit<AiProfile, "id"> }[] = [
  { label: "OpenAI", profile: { name: "OpenAI", format: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5" } },
  { label: "Anthropic (Claude)", profile: { name: "Claude", format: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" } },
  { label: "OpenRouter", profile: { name: "OpenRouter", format: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto" } },
  { label: "Google Gemini", profile: { name: "Gemini", format: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro" } },
  { label: "xAI (Grok)", profile: { name: "xAI", format: "openai", baseUrl: "https://api.x.ai/v1", model: "grok-4" } },
  { label: "Groq", profile: { name: "Groq", format: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" } },
  { label: "Ollama (local)", profile: { name: "Ollama", format: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.1" } },
];

export const VOICE_PRESETS: { label: string; profile: Omit<VoiceProfile, "id"> }[] = [
  { label: "OpenAI TTS", profile: { name: "OpenAI Voice", engine: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini-tts", voice: "alloy" } },
  { label: "xAI Grok TTS", profile: { name: "Grok Voice", engine: "xai", baseUrl: "https://api.x.ai/v1", model: "", voice: "eve" } },
  { label: "Custom OpenAI-compatible (local)", profile: { name: "Local Voice", engine: "openai", baseUrl: "http://localhost:8880/v1", model: "kokoro", voice: "af_bella" } },
];

interface SettingsState {
  profiles: AiProfile[];
  activeProfileId: string;
  voiceProfiles: VoiceProfile[];
  activeVoiceId: string;
  addProfile(p: Omit<AiProfile, "id">): string;
  updateProfile(id: string, patch: Partial<AiProfile>): void;
  removeProfile(id: string): void;
  setActive(id: string): void;
  addVoice(p: Omit<VoiceProfile, "id">): string;
  updateVoice(id: string, patch: Partial<VoiceProfile>): void;
  removeVoice(id: string): void;
  setActiveVoice(id: string): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => {
      const ai: AiProfile = { id: newId("prof"), ...PROFILE_PRESETS[0].profile };
      const voice: VoiceProfile = { id: newId("voice"), ...VOICE_PRESETS[0].profile };
      return {
        profiles: [ai],
        activeProfileId: ai.id,
        voiceProfiles: [voice],
        activeVoiceId: voice.id,
        addProfile: (p) => {
          const id = newId("prof");
          set((s) => ({ profiles: [...s.profiles, { id, ...p }] }));
          return id;
        },
        updateProfile: (id, patch) => set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
        removeProfile: (id) =>
          set((s) => {
            const profiles = s.profiles.filter((p) => p.id !== id);
            return { profiles, activeProfileId: s.activeProfileId === id ? (profiles[0]?.id ?? "") : s.activeProfileId };
          }),
        setActive: (activeProfileId) => set({ activeProfileId }),
        addVoice: (p) => {
          const id = newId("voice");
          set((s) => ({ voiceProfiles: [...s.voiceProfiles, { id, ...p }], activeVoiceId: s.activeVoiceId || id }));
          return id;
        },
        updateVoice: (id, patch) => set((s) => ({ voiceProfiles: s.voiceProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
        removeVoice: (id) =>
          set((s) => {
            const voiceProfiles = s.voiceProfiles.filter((p) => p.id !== id);
            return { voiceProfiles, activeVoiceId: s.activeVoiceId === id ? (voiceProfiles[0]?.id ?? "") : s.activeVoiceId };
          }),
        setActiveVoice: (activeVoiceId) => set({ activeVoiceId }),
      };
    },
    {
      name: "aive-settings-v2",
      version: 2,
      // v0–v1 kept TTS settings on an AI profile; give voice its own profile.
      // Keys are not copied: the voice profile needs its own key.
      migrate: (state) => {
        const s = state as Partial<SettingsState> & {
          tts?: { profileId?: string; engine?: TtsEngine; model?: string; voice?: string };
        };
        if (s.voiceProfiles) return s as SettingsState;
        const source = s.profiles?.find((p) => p.id === s.tts?.profileId);
        const engine = s.tts?.engine ?? "openai";
        const voice: VoiceProfile = {
          id: newId("voice"),
          name: engine === "xai" ? "Grok Voice" : "OpenAI Voice",
          engine,
          baseUrl: source?.baseUrl || (engine === "xai" ? "https://api.x.ai/v1" : "https://api.openai.com/v1"),
          model: s.tts?.model ?? TTS_ENGINES[engine].model,
          voice: s.tts?.voice ?? TTS_ENGINES[engine].voice,
        };
        const { tts: _drop, ...rest } = s;
        return { ...rest, voiceProfiles: [voice], activeVoiceId: voice.id } as SettingsState;
      },
    },
  ),
);

/** Connection fields for the active AI profile, as the Rust commands expect them. */
export function activeModel() {
  const s = useSettings.getState();
  const p = s.profiles.find((x) => x.id === s.activeProfileId) ?? s.profiles[0];
  if (!p) throw new Error(t("err.noProfile"));
  return { format: p.format, profileId: p.id, baseUrl: p.baseUrl || null, model: p.model };
}

/** Whether the app's own AI can run: a key is stored, or the endpoint is local (Ollama and the like). */
export async function aiReady(): Promise<boolean> {
  const s = useSettings.getState();
  const p = s.profiles.find((x) => x.id === s.activeProfileId) ?? s.profiles[0];
  if (!p) return false;
  if (p.format === "openai" && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(p.baseUrl)) return true;
  try {
    return !!(await ipc.apiKeysStatus([p.id]))[p.id];
  } catch {
    return false;
  }
}

/** Thrown before any change when an action needs the app's own AI and it has no key. */
export class NoAiError extends Error {}

/** Fails fast, before any change, for actions that need the app's own AI. */
export async function requireAi(): Promise<void> {
  if (!(await aiReady())) throw new NoAiError(t("err.noAiKey"));
}

export function voiceRequest(v: VoiceProfile) {
  return { profileId: v.id, baseUrl: v.baseUrl || null, engine: v.engine, model: v.model, voice: v.voice, speed: v.speed ?? 1 };
}

export function activeVoice(): VoiceProfile | undefined {
  const s = useSettings.getState();
  return s.voiceProfiles.find((v) => v.id === s.activeVoiceId) ?? s.voiceProfiles[0];
}

/** Connection fields for the active voice profile. */
export function ttsConnection() {
  const v = activeVoice();
  if (!v) throw new Error(t("err.ttsProfile"));
  return voiceRequest(v);
}
