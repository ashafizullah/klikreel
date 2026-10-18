import { expect, test } from "bun:test";
import { mergeRanges } from "./composition";
import { buildFrameDoc } from "./frameRuntime";

test("merges overlapping overlay ranges", () => {
  expect(mergeRanges([[3, 4], [0, 1], [0.5, 2], [4, 5]])).toEqual([[0, 2], [3, 5]]);
});

test("runtime is injected before user scripts", () => {
  const doc = buildFrameDoc("<html><head><title>x</title></head><body><script>window.__seek=t=>t</script></body></html>", { a: "1" });
  expect(doc.indexOf("aive:seek")).toBeLessThan(doc.indexOf("window.__seek=t=>t"));
  expect(doc).toContain('"a":"1"');
  expect(buildFrameDoc("<div>hi</div>", {})).toContain("<body");
});
