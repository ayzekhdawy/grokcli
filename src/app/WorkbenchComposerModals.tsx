/**
 * Composer-domain overlays: compact, queue edit, queue clear.
 * Host keeps send/connect; this file owns the modal mounts.
 */
import { CompactModal } from "@/components/workbench-modals/CompactModal";
import { ConfirmCopyModal } from "@/components/workbench-modals/ConfirmCopyModal";
import { QueueEditModal } from "@/components/workbench-modals/QueueEditModal";
import type { Locale } from "@/i18n";
import type { ContextUsageDisplay } from "@/lib/contextUsage";
import type { createT } from "@/i18n";
import type { useCompactDialog } from "@/hooks/useCompactDialog";
import type { useQueueEditDialog } from "@/hooks/useQueueEditDialog";

type TFn = ReturnType<typeof createT>;

export function WorkbenchComposerModals(props: {
  locale: Locale;
  tr: TFn;
  compact: ReturnType<typeof useCompactDialog>;
  queueEdit: ReturnType<typeof useQueueEditDialog>;
  turnLive: boolean;
  usage: ContextUsageDisplay;
}) {
  const { locale, tr, compact, queueEdit } = props;
  return (
    <>
      {compact.open && (
        <CompactModal
          locale={locale}
          formRef={compact.modalRef}
          noteInputRef={compact.noteRef}
          note={compact.note}
          preset={compact.preset}
          compactionMode={compact.compactionMode}
          compactionDetail={compact.compactionDetail}
          turnLive={props.turnLive}
          usage={props.usage}
          onClose={compact.close}
          onNoteChange={compact.setNote}
          onPresetChange={compact.selectPreset}
          onCompactionModeChange={compact.persistMode}
          onCompactionDetailChange={compact.persistDetail}
          onSubmit={(note, preset) => {
            compact.submit(note, preset, props.usage.tokens);
          }}
        />
      )}
      <QueueEditModal
        locale={locale}
        open={queueEdit.editItemId !== null}
        text={queueEdit.editText}
        textareaRef={queueEdit.textareaRef}
        onTextChange={queueEdit.setEditText}
        onClose={queueEdit.closeEdit}
        onSave={queueEdit.saveEdit}
      />
      <ConfirmCopyModal
        open={queueEdit.clearOpen}
        title={tr("composer.queueClearConfirmTitle")}
        body={
          queueEdit.clearPlan.confirmNeeded
            ? tr("composer.queueClearConfirmMessage", {
                n: String(queueEdit.clearPlan.count),
              })
            : tr("composer.queueClearEmpty")
        }
        closeLabel={tr("common.close")}
        cancelLabel={tr("common.cancel")}
        confirmLabel={tr("composer.queueClearConfirmAction")}
        danger
        confirmTestId="queue-clear-confirm"
        confirmDisabled={!queueEdit.clearPlan.confirmNeeded}
        onClose={() => queueEdit.setClearOpen(false)}
        onConfirm={queueEdit.confirmClear}
      />
    </>
  );
}
