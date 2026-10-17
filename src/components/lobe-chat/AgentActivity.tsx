import { memo } from "react";
/**
 * Mid-stream tool activity — Grok icon + one-line title.
 */

import type { Locale } from "@/i18n";
import type { ChatMessage } from "@/lib/session";
import { toolStepDisplayTitle } from "@/lib/session";
import { isBrowseToolKind, isSearchToolKind } from "@/lib/toolDisplay";
import { IconCircle, IconSearch, IconWorld } from "@/components/icons";
import { EndOfTurnChip } from "./EndOfTurnChip";

export {
  isToolStepMessage,
  isFailedToolStepMessage,
  pickLatestTurnTool,
  pickRunningTurnTool,
  toolStepDisplayTitle,
} from "@/lib/session";

export const LiveToolText = memo(function LiveToolText({
  message,
  locale: _locale,
}: {
  message: ChatMessage;
  locale: Locale;
}) {
  const title = toolStepDisplayTitle(message);
  if (!title) return null;

  const kind = message.toolKind;
  let icon = <IconCircle size={15} stroke={1.5} />;
  if (isBrowseToolKind(kind, title)) icon = <IconWorld size={15} stroke={1.5} />;
  else if (isSearchToolKind(kind, title))
    icon = <IconSearch size={15} stroke={1.5} />;

  return (
    <div
      className="grok-act__step is-running is-last"
      role="status"
      aria-live="polite"
      data-tool-id={message.toolCallId}
      title={message.toolDetail || message.toolPath || title}
    >
      <div className="grok-act__icon-col" aria-hidden>
        <span className="grok-act__icon">{icon}</span>
      </div>
      <span className="grok-act__label">{title}</span>
    </div>
  );
});

/** @deprecated Prefer EndOfTurnChip */
export function TurnCancelledRow({
  message,
  locale,
}: {
  message: ChatMessage;
  locale: Locale;
}) {
  return <EndOfTurnChip message={message} locale={locale} />;
}
