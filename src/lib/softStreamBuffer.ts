/**
 * Soft buffer for pure-text streaming first paint (CodePilot-style).
 * Holds initial text until word/char threshold or max wait; code fences bypass.
 *
 * NOTE: the hold only lasts until the *next* chunk/poll — a short intro before
 * tool calls must never stay invisible (that made small body text vanish until
 * the tools turned the unit non-streaming).
 */

export const SOFT_BUFFER_WORD_THRESHOLD = 12;
export const SOFT_BUFFER_CHAR_THRESHOLD = 40;
export const SOFT_BUFFER_MAX_MS = 2500;

/** Structured fences that must bypass the soft buffer for live preview. */
const STRUCTURED_FENCE_RE =
  /```(show-widget|batch-plan|image-gen|tsx|jsx|html|json|mermaid)/i;

export interface SoftBufferState {
  bypassed: boolean;
  /** epoch ms when first non-empty content arrived */
  firstContentAt: number | null;
  released: string;
}

export function createSoftBufferState(): SoftBufferState {
  return { bypassed: false, firstContentAt: null, released: "" };
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Pure step: given raw target and time, return what should be displayed.
 * When not streaming, always returns full target.
 */
export function stepSoftBuffer(input: {
  state: SoftBufferState;
  raw: string;
  streaming: boolean;
  nowMs: number;
  wordThreshold?: number;
  charThreshold?: number;
  maxMs?: number;
}): { state: SoftBufferState; displayed: string } {
  const {
    raw,
    streaming,
    nowMs,
    wordThreshold = SOFT_BUFFER_WORD_THRESHOLD,
    charThreshold = SOFT_BUFFER_CHAR_THRESHOLD,
    maxMs = SOFT_BUFFER_MAX_MS,
  } = input;
  let state = input.state;

  if (!streaming) {
    return {
      state: { bypassed: true, firstContentAt: state.firstContentAt, released: raw },
      displayed: raw,
    };
  }

  if (!raw) {
    return { state, displayed: state.released };
  }

  if (state.firstContentAt == null && raw.trim()) {
    state = { ...state, firstContentAt: nowMs };
  }

  // Reveal as soon as ANY content has arrived — streaming text must paint
  // immediately. The thresholds below only matter for the very first chunk
  // (already buffered): once firstContentAt is set we show the full text so
  // a short intro before tool calls is never hidden until tools start.
  const shouldBypass =
    state.bypassed ||
    STRUCTURED_FENCE_RE.test(raw) ||
    state.firstContentAt != null ||
    wordCount(raw) >= wordThreshold ||
    raw.length >= charThreshold ||
    (state.firstContentAt != null && nowMs - state.firstContentAt >= maxMs);

  if (shouldBypass) {
    return {
      state: { ...state, bypassed: true, released: raw },
      displayed: raw,
    };
  }

  // Still buffering — show nothing (or previous released empty).
  return { state, displayed: state.released };
}
