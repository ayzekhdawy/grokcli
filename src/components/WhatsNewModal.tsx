/**
 * Per-version update notes — GlassModal, CHANGELOG.md source.
 * Items are already first-sentence / bold-lead lines from `changelogPopupItem`.
 */

import { useMemo } from "react";
import { GlassModal } from "@/components/GlassModal";
import {
  createT,
  resolveLocale,
  type Locale,
  type MessageKey,
} from "@/i18n";
import type { WhatsNewNotes, WhatsNewSectionId } from "@/lib/whatsNew";

export type WhatsNewModalProps = {
  open: boolean;
  locale: Locale | string | undefined;
  version: string;
  notes: WhatsNewNotes | null;
  onClose: () => void;
};

const SECTION_KEYS: Record<WhatsNewSectionId, MessageKey> = {
  added: "whatsNew.section.added",
  changed: "whatsNew.section.changed",
  fixed: "whatsNew.section.fixed",
};

export function WhatsNewModal({
  open,
  locale,
  version,
  notes,
  onClose,
}: WhatsNewModalProps) {
  const tr = useMemo(
    () => createT(resolveLocale(locale)),
    [locale],
  );

  const footer = (
    <button type="button" className="btn btn--primary" onClick={onClose}>
      {tr("whatsNew.gotIt")}
    </button>
  );

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("whatsNew.title", { version })}
      size="md"
      closeLabel={tr("common.close")}
      className="whats-new"
      wrapBody
      bodyClassName="whats-new__body-wrap"
      footer={footer}
    >
      {notes?.highlight ? (
        <p className="whats-new__highlight">{notes.highlight}</p>
      ) : null}
      {notes && notes.sections.length > 0 ? (
        notes.sections.map((section) => (
          <section key={section.id} className="whats-new__section">
            <h3 className="whats-new__heading">{tr(SECTION_KEYS[section.id])}</h3>
            <ul className="whats-new__list">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="whats-new__empty">{tr("whatsNew.empty")}</p>
      )}
    </GlassModal>
  );
}
