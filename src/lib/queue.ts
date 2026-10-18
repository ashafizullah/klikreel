/** Runs async jobs with at most `limit` in flight; the rest wait in FIFO order. */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
    async run<T>(job: () => Promise<T>, onStart?: () => void): Promise<T> {
      if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
      active++;
      onStart?.();
      try {
        return await job();
      } finally {
        active--;
        waiting.shift()?.();
      }
    },
  };
}
