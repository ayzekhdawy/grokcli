/**
 * Schedule work for the next paint, with a short timeout fallback.
 *
 * `requestAnimationFrame` follows the **main** display's vsync. On macOS
 * with a 120Hz built-in panel and a 75Hz external, a window on the
 * external can miss a vsync (~13ms) and the next rAF lands at ~26ms —
 * visually 37.5Hz stutter. A ~half-75Hz timeout still commits this
 * scroll burst if rAF is late.
 */

export const MIXED_DISPLAY_FRAME_FALLBACK_MS = 8;

export type FrameSchedule = {
  raf: number | null;
  timeout: ReturnType<typeof setTimeout> | null;
};

export function emptyFrameSchedule(): FrameSchedule {
  return { raf: null, timeout: null };
}

export function isFrameSchedulePending(s: FrameSchedule): boolean {
  return s.raf != null || s.timeout != null;
}

export type FrameScheduleHost = {
  raf: (cb: FrameRequestCallback) => number;
  cancelRaf: (id: number) => void;
  timeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

const defaultHost: FrameScheduleHost = {
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (id) => cancelAnimationFrame(id),
  timeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export function cancelFrameSchedule(
  state: FrameSchedule,
  host: FrameScheduleHost = defaultHost,
): void {
  if (state.raf != null) {
    host.cancelRaf(state.raf);
    state.raf = null;
  }
  if (state.timeout != null) {
    host.clearTimeout(state.timeout);
    state.timeout = null;
  }
}

/** Arm once; later calls no-op until the scheduled run fires or is cancelled. */
export function scheduleOnFrame(
  state: FrameSchedule,
  run: () => void,
  host: FrameScheduleHost = defaultHost,
): void {
  if (state.raf != null || state.timeout != null) return;
  const fire = () => {
    cancelFrameSchedule(state, host);
    run();
  };
  state.raf = host.raf(fire);
  state.timeout = host.timeout(fire, MIXED_DISPLAY_FRAME_FALLBACK_MS);
}
