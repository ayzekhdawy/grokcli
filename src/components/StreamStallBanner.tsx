import type { MessageKey } from "@/i18n";
import type { SessionLiveSnapshot } from "@/lib/sessionLiveStore";
import { stallMessageKey } from "@/lib/sessionPhase";
import {
  resolveStallBannerTier,
  stallCauseMessageKey,
  type StreamStallView,
} from "@/lib/streamStallView";

type Stall = NonNullable<StreamStallView>;

/**
 * Soft STREAM_STALL banner. Keep waiting dismisses it. End and continue
 * waits until cancel is delivered. End turn stops the viewed chat.
 */
export function StreamStallBanner({
  stall,
  sessionId,
  live,
  tr,
  busy,
  onKeepWaiting,
  onEndTurn,
  onEndAndContinue,
}: {
  stall: Stall;
  sessionId?: string | null;
  live?: SessionLiveSnapshot;
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string;
  busy: boolean;
  onKeepWaiting: () => void;
  onEndTurn: () => void;
  onEndAndContinue: (sessionId: string) => void;
}) {
  const saw = !!stall.sawModelOutput || !!live?.sawModelOutput;
  const tools = !!stall.sawToolActivity || !!live?.sawToolActivity;
  const tier = resolveStallBannerTier({
    hostTier: stall.tier,
    sawModelOutput: saw,
    sawToolActivity: tools,
  });
  const soft = tier === "maybe_done" || tier === "post_output";
  const summaryKey = stallMessageKey(tier);
  const summary =
    summaryKey === "endOfTurn.stall"
      ? tr("error.deck.stall.problem")
      : tr(summaryKey);
  const causeKey = stallCauseMessageKey(!!stall.streamInterrupted);

  return (
    <div
      className={`stall-banner error-banner${soft ? " stall-banner--soft" : ""}`}
      role="status"
    >
      <div className="error-banner__code">STREAM_STALL</div>
      <div className="error-banner__summary">{summary}</div>
      <div className="error-banner__cause">
        {tr(causeKey, { seconds: String(stall.stallSeconds) })}
      </div>
      <div className="stall-banner__actions error-banner__actions">
        <button
          type="button"
          className="btn btn--primary stall-banner__btn"
          disabled={busy}
          onClick={onKeepWaiting}
        >
          {tr("agent.streamStallKeepWaiting")}
        </button>
        <button
          type="button"
          className="btn btn--ghost stall-banner__btn"
          disabled={busy}
          onClick={() => {
            const sid = (stall.sessionId || sessionId || "").trim();
            if (!sid) return;
            onEndAndContinue(sid);
          }}
        >
          {tr("agent.streamStallEndAndContinue")}
        </button>
        <button
          type="button"
          className="btn btn--ghost stall-banner__btn"
          disabled={busy}
          onClick={onEndTurn}
        >
          {tr("agent.streamStallEndTurn")}
        </button>
      </div>
    </div>
  );
}
