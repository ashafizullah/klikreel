import { expect, test } from "bun:test";
import type { Scene } from "../types/project";
import { emptyProject, useProject } from "./project";

const scene = (over: Partial<Scene> = {}): Scene => ({
  id: "s1", title: "A", narration: "", visual: "", duration: 3, html: "<p>v1</p>", status: "ready", assetRefs: {}, ...over,
});

const settle = () => new Promise((r) => setTimeout(r, 450)); // history groups edits within 400 ms

test("an AI edit is a single undo step and never restores a spinner", async () => {
  useProject.getState().load(emptyProject(), null);
  useProject.getState().setScenes([scene()]); // builds the scene tracks
  await settle();
  useProject.temporal.getState().clear();
  await settle();

  const { updateScene } = useProject.getState();
  updateScene("s1", { status: "generating" });
  await settle();
  updateScene("s1", { html: "<p>v2</p>", status: "ready" });
  await settle();

  expect(useProject.temporal.getState().pastStates).toHaveLength(1);
  useProject.temporal.getState().undo();
  const s = useProject.getState().project.scenes[0];
  expect(s.html).toBe("<p>v1</p>");
  expect(s.status).toBe("ready");
});
