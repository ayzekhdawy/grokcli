/**
 * Coalesce stream deltas so IM patch count << raw token count.
 */

export function createStreamCoalescer(
  append: (chunk: string) => Promise<void>,
  coalesceMs: number,
): {
  push: (delta: string) => Promise<void>;
  flush: () => Promise<void>;
  broken: () => boolean;
  patchCount: () => number;
} {
  let buffer = "";
  let lastFlush = 0;
  let chain: Promise<void> = Promise.resolve();
  let broken = false;
  let patches = 0;

  const doFlush = async () => {
    if (!buffer || broken) {
      buffer = "";
      return;
    }
    const chunk = buffer;
    buffer = "";
    lastFlush = Date.now();
    try {
      await append(chunk);
      patches++;
    } catch {
      broken = true;
      buffer = "";
    }
  };

  return {
    push: async (delta: string) => {
      if (!delta || broken) return;
      buffer += delta;
      const now = Date.now();
      if (coalesceMs <= 0 || buffer.length >= 120 || now - lastFlush >= coalesceMs) {
        chain = chain.then(doFlush).catch(() => undefined);
        await chain;
      }
    },
    flush: async () => {
      chain = chain.then(doFlush).catch(() => undefined);
      await chain;
    },
    broken: () => broken,
    patchCount: () => patches,
  };
}
