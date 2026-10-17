import {
  normalizeStallTier,
  stallTierFromProgress,
  type StallTier,
} from "./sessionPhase";

/** `session://stream_stall` as the UI stores it. `null` means the banner is hidden. */
export type StreamStallView = {
  sessionId?: string;
  stallSeconds: number;
  tier?: string;
  sawModelOutput?: boolean;
  sawToolActivity?: boolean;
  /** This turn already saw a body-decode retry. Changes the cause line only. */
  streamInterrupted?: boolean;
} | null;

/**
 * Host tier wins. A missing tier is inferred from body/tools only.
 * An in-flight turn that already spoke is post_output, never maybe_done.
 */
export function resolveStallBannerTier(input: {
  hostTier?: string | null;
  sawModelOutput: boolean;
  sawToolActivity: boolean;
}): StallTier {
  return (
    normalizeStallTier(input.hostTier) ??
    stallTierFromProgress({
      sawModelOutput: input.sawModelOutput,
      sawToolActivity: input.sawToolActivity,
    })
  );
}

export function stallCauseMessageKey(
  streamInterrupted: boolean,
): "error.deck.stall.causeStreamInterrupted" | "error.deck.stall.cause" {
  return streamInterrupted
    ? "error.deck.stall.causeStreamInterrupted"
    : "error.deck.stall.cause";
}
