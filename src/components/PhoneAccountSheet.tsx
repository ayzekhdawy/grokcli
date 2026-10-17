/**
 * Phone-only account / status sheet (top-bar account button).
 * Holds host account summary + connection status pills that used to
 * crowd the 390px top bar. Desktop never mounts this.
 */

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconClose, IconPanelRight, IconUser } from "@/components/icons";
import { installDialogFocus } from "@/lib/a11yFocus";

export type PhoneAccountSheetProps = {
  open: boolean;
  onClose: () => void;
  labels: {
    title: string;
    close: string;
    hostAccount: string;
    linkStatus: string;
    agentStatus: string;
    openFiles: string;
    connected: string;
    reconnecting: string;
    /** Optional: disconnected / token-missing honesty (MIRROR-PRO). */
    disconnected?: string;
    tokenMissing?: string;
  };
  hostLabel: string | null;
  linkOk: boolean;
  /** Honest link tone from deriveMirrorClientLinkStatus (default ok/warn). */
  linkTone?: "ok" | "warn" | "err" | "muted";
  /** Override link pill label (connected / reconnecting / disconnected). */
  linkStatusLabel?: string | null;
  agentStatusLabel: string;
  agentTone: "ok" | "warn" | "err" | "muted";
  onOpenFiles: () => void;
};

export function PhoneAccountSheet({
  open,
  onClose,
  labels,
  hostLabel,
  linkOk,
  linkTone,
  linkStatusLabel,
  agentStatusLabel,
  agentTone,
  onOpenFiles,
}: PhoneAccountSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    return installDialogFocus(() => panelRef.current, {
      onEscape: () => onCloseRef.current(),
      capture: true,
      initialFocus: "first",
      restoreFocus: true,
    });
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="phone-sheet" role="presentation">
      <button
        type="button"
        className="phone-sheet__scrim"
        aria-label={labels.close}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="phone-sheet__panel phone-sheet__panel--account"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="phone-sheet__handle" aria-hidden />
        <div className="phone-sheet__head">
          <span className="phone-sheet__icon-btn phone-sheet__icon-btn--spacer" />
          <h2 id={titleId} className="phone-sheet__title">
            {labels.title}
          </h2>
          <button
            type="button"
            className="phone-sheet__icon-btn"
            onClick={onClose}
            aria-label={labels.close}
          >
            <IconClose size={18} />
          </button>
        </div>
        <div className="phone-sheet__body">
          <div className="phone-account__card">
            <div className="phone-account__avatar" aria-hidden>
              <IconUser size={22} />
            </div>
            <div className="phone-account__meta">
              <span className="phone-account__label">{labels.hostAccount}</span>
              <span className="phone-account__name">
                {hostLabel || labels.reconnecting}
              </span>
            </div>
          </div>

          <div className="phone-account__status-list">
            <div className="phone-account__status-row">
              <span className="phone-account__status-label">
                {labels.linkStatus}
              </span>
              <span
                className={
                  "status-pill status-pill--" +
                  (linkTone ?? (linkOk ? "ok" : "warn"))
                }
              >
                <span className="status-pill__dot" aria-hidden />
                {linkStatusLabel ??
                  (linkOk ? labels.connected : labels.reconnecting)}
              </span>
            </div>
            <div className="phone-account__status-row">
              <span className="phone-account__status-label">
                {labels.agentStatus}
              </span>
              <span className={`status-pill status-pill--${agentTone}`}>
                <span className="status-pill__dot" aria-hidden />
                {agentStatusLabel}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="phone-sheet__row"
            onClick={() => {
              onOpenFiles();
              onClose();
            }}
          >
            <span className="phone-sheet__row-icon" aria-hidden>
              <IconPanelRight size={20} />
            </span>
            <span className="phone-sheet__row-label">{labels.openFiles}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
