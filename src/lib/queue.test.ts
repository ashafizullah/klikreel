import { expect, test } from "bun:test";
import { createLimiter } from "./queue";

test("never runs more than the limit and keeps FIFO order", async () => {
  const q = createLimiter(2);
  let running = 0;
  let peak = 0;
  const started: number[] = [];
  const job = (i: number) =>
    q.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return i;
    }, () => started.push(i));
  const results = await Promise.all([0, 1, 2, 3, 4].map(job));
  expect(results).toEqual([0, 1, 2, 3, 4]);
  expect(peak).toBe(2);
  expect(started).toEqual([0, 1, 2, 3, 4]);
});

test("a failing job frees its slot", async () => {
  const q = createLimiter(1);
  await expect(q.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
  expect(await q.run(async () => 7)).toBe(7);
  expect(q.active).toBe(0);
});
