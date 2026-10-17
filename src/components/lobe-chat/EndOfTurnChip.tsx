/**
 * Unified end-of-turn marker (stop / stall / error / permission).
 */

import { memo, useMemo, type ReactNode } from "react";
import type { Locale } from "@/i18n";
import { createT, type MessageKey } from "@/i18n";
import {
  endOfTurnChipShowsContinue,
  mapEndOfTurnReason,
  parseEndOfTurnContent,
  type EndOfTurnReason,
} from "@/lib/endOfTurn";
import { IconAlertTriangle, IconClock, IconShield } from "@/components/icons";
import type { ChatMessage } from "@/lib/session";

function resolveRawReason(
  reasonOverride: EndOfTurnReason | string | null | undefined,
  message: ChatMessage | undefined,
): string {
  if (reasonOverride) return String(reasonOverride);
  // Prefer journal content (carries user_stop / agent_exit after reload).
  // toolStatus alone is often missing on history rows (mapStoredMessages).
  const fromContent = parseEndOfTurnContent(message?.content);
  if (fromContent) return fromContent;
  if (message?.toolStatus) return String(message.toolStatus);
  return "cancelled";
}

/**
 * Mark glyph: CSS stop square for cancel (Tabler filled stop has viewBox
 * padding that won't sit on the text midline at ~12px). Outline icons for
 * stall / permission / error.
 */
function EndOfTurnMark({ reason }: { reason: EndOfTurnReason }): ReactNode {
  if (reason === "stall") {
    return <IconClock size={14} stroke={1.75} />;
  }
  if (reason === "permission_denied") {
    return <IconShield size={14} stroke={1.75} />;
  }
  if (
    reason === "error" ||
    reason === "cli_upgrade" ||
    reason === "app_update" ||
    reason === "account_auth" ||
    reason === "provider_route" ||
    reason === "session_data_mode" ||
    reason === "host_exit"
  ) {
    return <IconAlertTriangle size={14} stroke={1.75} />;
  }
  // user_stop / cancelled / agent_exit / unknown — solid stop square
  return <span className="lobe-end-turn__stop" />;
}

export const EndOfTurnChip = memo(function EndOfTurnChip({
  message,
  locale,
  reasonOverride,
  onContinue,
  continueDisabled,
}: {
  message?: ChatMessage;
  locale: Locale;
  reasonOverride?: EndOfTurnReason | string | null;
  onContinue?: (reason: EndOfTurnReason) => void;
  continueDisabled?: boolean;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const raw = resolveRawReason(reasonOverride, message);
  const model = mapEndOfTurnReason(String(raw));
  const label = tr(model.messageKey as MessageKey);
  const showContinue = !!onContinue && endOfTurnChipShowsContinue(model.reason);

  return (
    <div
      className={`lobe-end-turn lobe-end-turn--${model.tone}`}
      role="status"
      data-reason={model.reason}
      data-testid="end-of-turn"
    >
      <span className="lobe-end-turn__mark" aria-hidden>
        <EndOfTurnMark reason={model.reason} />
      </span>
      <span className="lobe-end-turn__title">{label}</span>
      {showContinue ? (
        <button
          type="button"
          className="lobe-end-turn__continue"
          disabled={continueDisabled}
          onClick={() => onContinue?.(model.reason)}
        >
          {tr("endOfTurn.continue")}
        </button>
      ) : null}
    </div>
  );
});
