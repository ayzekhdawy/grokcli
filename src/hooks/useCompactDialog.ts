/**
 * Compact slash dialog: open/note/preset, compaction mode persistence,
 * and focus trap. Sending `/compact` uses host-bound ensureConnected.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as api from "@/lib/api";
import { installDialogFocus } from "@/lib/a11yFocus";
import {
  DEFAULT_COMPACTION_DETAIL,
  DEFAULT_COMPACTION_MODE,
  normalizeCompactionDetail,
  normalizeCompactionMode,
  type CompactionDetailId,
  type CompactionModeId,
} from "@/lib/compactionMode";
import {
  buildCompactSlashCommand,
  DEFAULT_COMPACT_PRESET,
  resolveCompactNoteBody,
  type CompactPresetId,
} from "@/lib/contextUsage";
import { createT } from "@/i18n";

export type CompactPendingBefore = {
  sessionId: string;
  tokensBefore: number | null;
  at: number;
};

type TFn = ReturnType<typeof createT>;

export function compactPresetNote(tr: TFn, id: CompactPresetId): string {
  if (id === "light") return tr("slash.compactPresetNote.light");
  if (id === "aggressive") return tr("slash.compactPresetNote.aggressive");
  return tr("slash.compactPresetNote.standard");
}

export function useCompactDialog(opts: {
  tr: TFn;
  ensureConnectedRef: MutableRefObject<() => Promise<string | null>>;
  onFail: (msg: string) => void;
}) {
  const { tr, ensureConnectedRef, onFail } = opts;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [preset, setPreset] = useState<CompactPresetId>(DEFAULT_COMPACT_PRESET);
  const [compactionMode, setCompactionMode] = useState<CompactionModeId>(
    DEFAULT_COMPACTION_MODE,
  );
  const [compactionDetail, setCompactionDetail] =
    useState<CompactionDetailId>(DEFAULT_COMPACTION_DETAIL);
  const modalRef = useRef<HTMLFormElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const pendingBeforeRef = useRef<CompactPendingBefore | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setNote("");
    setPreset(DEFAULT_COMPACT_PRESET);
  }, []);

  useEffect(() => {
    if (!open) return;
    return installDialogFocus(() => modalRef.current, {
      onEscape: close,
      capture: true,
      initialFocus: () => noteRef.current,
      restoreFocus: true,
    });
  }, [open, close]);

  const openWithPresetNote = useCallback(() => {
    setPreset(DEFAULT_COMPACT_PRESET);
    setNote(compactPresetNote(tr, DEFAULT_COMPACT_PRESET));
    setOpen(true);
  }, [tr]);

  const openBare = useCallback(() => {
    setNote("");
    setOpen(true);
  }, []);

  const selectPreset = useCallback(
    (id: CompactPresetId) => {
      setPreset(id);
      setNote(compactPresetNote(tr, id));
    },
    [tr],
  );

  const persistMode = useCallback((next: CompactionModeId) => {
    setCompactionMode(next);
    void api.settingsGet().then((s) =>
      api.settingsSet({ ...s, compactionMode: next }),
    );
  }, []);

  const persistDetail = useCallback((next: CompactionDetailId) => {
    setCompactionDetail(next);
    void api.settingsGet().then((s) =>
      api.settingsSet({ ...s, compactionDetail: next }),
    );
  }, []);

  const applyFromSettings = useCallback(
    (s: { compactionMode?: string; compactionDetail?: string }) => {
      setCompactionMode(normalizeCompactionMode(s.compactionMode));
      setCompactionDetail(normalizeCompactionDetail(s.compactionDetail));
    },
    [],
  );

  const submit = useCallback(
    (nextNote: string, nextPreset: CompactPresetId, tokensBefore: number | null | undefined) => {
      const body = resolveCompactNoteBody(
        nextNote,
        compactPresetNote(tr, nextPreset),
      );
      close();
      void (async () => {
        const cmd = buildCompactSlashCommand(body, { preset: nextPreset });
        try {
          const sid = await ensureConnectedRef.current();
          if (!sid) {
            onFail(tr("slash.compactConnectFailed"));
            return;
          }
          pendingBeforeRef.current = {
            sessionId: sid,
            tokensBefore:
              tokensBefore != null && Number.isFinite(tokensBefore)
                ? Math.floor(tokensBefore)
                : null,
            at: Date.now(),
          };
          await api.sessionSend(cmd, null, sid);
        } catch (err) {
          pendingBeforeRef.current = null;
          onFail(String(err));
        }
      })();
    },
    [close, ensureConnectedRef, onFail, tr],
  );

  return {
    open,
    setOpen,
    note,
    setNote,
    preset,
    compactionMode,
    compactionDetail,
    modalRef,
    noteRef,
    pendingBeforeRef,
    close,
    openWithPresetNote,
    openBare,
    selectPreset,
    persistMode,
    persistDetail,
    applyFromSettings,
    submit,
    setCompactionMode,
    setCompactionDetail,
  };
}
