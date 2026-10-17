/**
 * Send-queue item editor + clear-all confirm. Pause/resume flush stays on
 * useSendQueue; this hook owns dialog state only.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { createT } from "@/i18n";
import {
  planClearSendQueue,
  type QueuedSend,
} from "@/lib/sendQueue";

type TFn = ReturnType<typeof createT>;

export function useQueueEditDialog(opts: {
  tr: TFn;
  showToast: (msg: string, ms?: number) => void;
  activeQueue: QueuedSend[];
  updateItem: (id: string, patch: { storedDisplay: string }) => void;
  pauseFlush: () => void;
  releaseFlushHold: () => void;
  clearQueue: () => void;
}) {
  const {
    tr,
    showToast,
    activeQueue,
    updateItem,
    pauseFlush,
    releaseFlushHold,
    clearQueue,
  } = opts;
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const closeEdit = useCallback(() => {
    setEditItemId(null);
    setEditText("");
    releaseFlushHold();
  }, [releaseFlushHold]);

  const openEdit = useCallback(
    (item: QueuedSend) => {
      pauseFlush();
      setEditItemId(item.id);
      setEditText(item.storedDisplay);
      window.setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 0);
    },
    [pauseFlush],
  );

  const saveEdit = useCallback(() => {
    if (!editItemId) return;
    const item = activeQueue.find((q) => q.id === editItemId);
    if (!item) {
      closeEdit();
      return;
    }
    const trimmed = editText.trim();
    if (!trimmed && item.attachments.length === 0) {
      showToast(tr("composer.queueEditEmpty"), 2800);
      return;
    }
    updateItem(editItemId, { storedDisplay: trimmed });
    closeEdit();
  }, [
    editItemId,
    editText,
    activeQueue,
    updateItem,
    closeEdit,
    showToast,
    tr,
  ]);

  const clearPlan = useMemo(
    () => planClearSendQueue(activeQueue),
    [activeQueue],
  );

  const requestClear = useCallback(() => {
    const plan = planClearSendQueue(activeQueue);
    if (!plan.confirmNeeded) return;
    setClearOpen(true);
  }, [activeQueue]);

  const confirmClear = useCallback(() => {
    clearQueue();
    setClearOpen(false);
  }, [clearQueue]);

  return {
    editItemId,
    editText,
    setEditText,
    textareaRef,
    openEdit,
    closeEdit,
    saveEdit,
    clearOpen,
    setClearOpen,
    clearPlan,
    requestClear,
    confirmClear,
  };
}
