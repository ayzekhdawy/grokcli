import { describe, expect, it, vi } from "vitest";
import {
  MIXED_DISPLAY_FRAME_FALLBACK_MS,
  cancelFrameSchedule,
  emptyFrameSchedule,
  isFrameSchedulePending,
  scheduleOnFrame,
  type FrameScheduleHost,
} from "./frameSchedule";

function mockHost() {
  let rafId = 0;
  let toId = 0;
  const rafs = new Map<number, FrameRequestCallback>();
  const tos = new Map<number, () => void>();
  const host: FrameScheduleHost = {
    raf: (cb) => {
      const id = ++rafId;
      rafs.set(id, cb);
      return id;
    },
    cancelRaf: (id) => {
      rafs.delete(id);
    },
    timeout: (cb, _ms) => {
      const id = ++toId;
      tos.set(id, cb);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      tos.delete(id as unknown as number);
    },
  };
  return {
    host,
    flushRaf: () => {
      const first = rafs.entries().next().value;
      if (!first) return;
      const [id, cb] = first;
      rafs.delete(id);
      cb(0);
    },
    flushTimeout: () => {
      const first = tos.entries().next().value;
      if (!first) return;
      const [id, cb] = first;
      tos.delete(id);
      cb();
    },
    rafCount: () => rafs.size,
    timeoutCount: () => tos.size,
  };
}

describe("scheduleOnFrame", () => {
  it("uses an 8ms fallback constant definition", () => {
    expect(MIXED_DISPLAY_FRAME_FALLBACK_MS).toBe(8);
  });

  it("runs once when rAF fires and clears pending state", () => {
    const m = mockHost();
    const state = emptyFrameSchedule();
    const run = vi.fn();
    scheduleOnFrame(state, run, m.host);
    expect(isFrameSchedulePending(state)).toBe(true);
    scheduleOnFrame(state, run, m.host);
    expect(m.rafCount()).toBe(1);
    m.flushRaf();
    expect(run).toHaveBeenCalledTimes(1);
    expect(isFrameSchedulePending(state)).toBe(false);
  });

  it("runs once when timeout fires before rAF and clears dual channels", () => {
    const m = mockHost();
    const state = emptyFrameSchedule();
    const run = vi.fn();
    scheduleOnFrame(state, run, m.host);
    expect(isFrameSchedulePending(state)).toBe(true);
    expect(m.rafCount()).toBe(1);
    expect(m.timeoutCount()).toBe(1);
    m.flushTimeout();
    expect(run).toHaveBeenCalledTimes(1);
    expect(isFrameSchedulePending(state)).toBe(false);
    expect(m.rafCount()).toBe(0);
    expect(m.timeoutCount()).toBe(0);
  });

  it("cancelFrameSchedule cancels pending rAF", () => {
    const m = mockHost();
    const state = emptyFrameSchedule();
    const run = vi.fn();
    scheduleOnFrame(state, run, m.host);
    cancelFrameSchedule(state, m.host);
    expect(isFrameSchedulePending(state)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
