import { expect, test } from "bun:test";
import type { Scene } from "../types/project";
import { emptyProject } from "../store/project";
import { fitDuration, moveSceneTo, relayout } from "./scenes";

const scene = (id: string, duration: number, extra: Partial<Scene> = {}): Scene => ({
  id, title: id, narration: "", visual: "", duration, html: "", status: "ready", assetRefs: {}, ...extra,
});

test("relayout places scenes back to back with voice", () => {
  const p = emptyProject({ scenes: [scene("a", 3, { voicePath: "/a.mp3", voiceDuration: 2 }), scene("b", 4)] });
  relayout(p);
  const scenes = p.tracks.find((t) => t.role === "scenes")!;
  expect(scenes.clips.map((c) => [c.start, c.duration])).toEqual([[0, 3], [3, 4]]);
  const voice = p.tracks.find((t) => t.role === "voice")!;
  expect(voice.clips).toHaveLength(1);
  expect(voice.clips[0].start).toBeCloseTo(0.3);
  expect(p.assets["ast_voice_a"].path).toBe("/a.mp3");
  // Scenes track sits below user overlays and above video.
  const order = p.tracks.map((t) => t.role ?? t.kind);
  expect(order.indexOf("scenes")).toBeLessThan(order.indexOf("video"));
  relayout(p);
  expect(p.tracks.filter((t) => t.role === "scenes")).toHaveLength(1);
});

test("moving a scene reorders by drop position", () => {
  const p = emptyProject({ scenes: [scene("a", 2), scene("b", 2), scene("c", 2)] });
  moveSceneTo(p, "a", 1.5);
  expect(p.scenes.map((s) => s.id)).toEqual(["b", "a", "c"]);
  moveSceneTo(p, "c", 0);
  expect(p.scenes.map((s) => s.id)).toEqual(["c", "b", "a"]);
});

test("fitDuration grows to fit narration", () => {
  expect(fitDuration(scene("a", 3, { voiceDuration: 4 }))).toBe(4.9);
  expect(fitDuration(scene("a", 6, { voiceDuration: 2 }))).toBe(6);
});

test("narration language maps to a BCP-47 code", async () => {
  const { languageCode } = await import("./producer");
  expect(languageCode("Indonesian")).toBe("id");
  expect(languageCode("English")).toBe("en");
  expect(languageCode("pt-BR")).toBe("pt-BR");
  expect(languageCode("Klingon")).toBe("auto");
});

test("speaking rate depends on the narration language", async () => {
  const { wordsPerSecond } = await import("./producer");
  expect(wordsPerSecond("Indonesian")).toBe(1.9);
  expect(wordsPerSecond("English")).toBe(2.5);
  expect(wordsPerSecond("Klingon")).toBe(2.2);
});

test("voice fitting math", async () => {
  const { voiceSlot, fitTempo } = await import("./producer");
  expect(voiceSlot(5)).toBeCloseTo(4.1);
  expect(fitTempo(4, 4.1)).toBe(1);
  expect(fitTempo(4.5, 4.1)).toBeCloseTo(1.098, 3);
  expect(fitTempo(6, 4.1)).toBeNull();
});

test("exactFit wraps the voiceover and may shrink", async () => {
  const { exactFit } = await import("./scenes");
  expect(exactFit(3)).toBe(3.9);
  expect(exactFit(0.2)).toBe(1.5);
});

test("narration cues split time by sentence length", async () => {
  const { narrationCues } = await import("./producer");
  const cues = narrationCues("Halo dunia. Ini tes!", 0.3, 4);
  expect(cues.split("\n")).toHaveLength(2);
  expect(cues).toContain("0.3s");
  expect(cues).toContain("4.3s");
});

test("directed xAI scripts must keep the narration's words", async () => {
  const { keepsWords, stripSpeechTags } = await import("./producer");
  const line = "Kirim invoice lewat WhatsApp, otomatis!";
  const directed = "[breath] Kirim invoice lewat <emphasis>WhatsApp</emphasis>, [pause] <build-intensity>otomatis!</build-intensity>";
  expect(stripSpeechTags(directed)).toBe("Kirim invoice lewat WhatsApp, otomatis!");
  expect(keepsWords(line, directed)).toBe(true);
  expect(keepsWords(line, "Kirim tagihan lewat <emphasis>WhatsApp</emphasis>")).toBe(false);
});
