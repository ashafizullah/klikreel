import { describe, expect, test } from "bun:test";
import type { Asset, Clip, Track } from "../types/project";
import { DEFAULT_TRANSFORM } from "../types/project";
import { fadeFactor, firstFreeSlot, overlaps, snap, splitClip, trimLeft, trimRight } from "./timeline";

const assets: Record<string, Asset> = {
  a: { id: "a", path: "/a.mp4", name: "a", kind: "video", duration: 10, width: 1920, height: 1080, fps: 30, hasAudio: true },
};
const clip = (over: Partial<Clip> = {}): Clip => ({
  id: "c1", name: "c", start: 2, duration: 4, trimIn: 1,
  source: { type: "media", assetId: "a" }, transform: DEFAULT_TRANSFORM,
  fadeIn: 0.5, fadeOut: 0.5, volume: 1, ...over,
});
const track = (clips: Clip[]): Track => ({ id: "t", kind: "video", name: "", muted: false, hidden: false, locked: false, clips });

describe("timeline ops", () => {
  test("split keeps source continuity", () => {
    const [l, r] = splitClip(clip(), 3, "c2")!;
    expect(l.duration).toBe(1);
    expect(r).toMatchObject({ id: "c2", start: 3, duration: 3, trimIn: 2, fadeIn: 0 });
    expect(l.fadeOut).toBe(0);
    expect(splitClip(clip(), 2.01, "x")).toBeNull();
  });

  test("trimLeft cannot reveal media before 0", () => {
    const c = trimLeft(clip(), 0, assets);
    expect(c.start).toBe(1);
    expect(c.trimIn).toBe(0);
    expect(c.start + c.duration).toBe(6);
  });

  test("trimRight is limited by media length", () => {
    expect(trimRight(clip(), 20, assets).duration).toBe(9);
    const text = clip({ source: { type: "text", text: "x", style: {} as never } });
    expect(trimRight(text, 20, assets).duration).toBe(18);
  });

  test("overlap and free slot", () => {
    const t = track([clip(), clip({ id: "c2", start: 8, duration: 2 })]);
    expect(overlaps(t, 5, 2)).toBe(true);
    expect(overlaps(t, 6, 2)).toBe(false);
    expect(firstFreeSlot(t, 3, 3)).toBe(10);
    expect(firstFreeSlot(t, 0, 2)).toBe(0);
  });

  test("snap picks the closest edge", () => {
    expect(snap(4.95, [0, 2], [5, 7.1], 0.2)).toEqual({ value: 5, guide: 5 });
    expect(snap(3, [0], [5], 0.2)).toEqual({ value: 3, guide: null });
  });

  test("fade factor", () => {
    const c = clip();
    expect(fadeFactor(c, 0.25)).toBe(0.5);
    expect(fadeFactor(c, 2)).toBe(1);
    expect(fadeFactor(c, 3.75)).toBe(0.5);
  });
});

