/**
 * Composer domain controller (slash / draft / attachments / @ / + panels).
 * Extracted from AppWorkbench; onSend / session boundary stays in workbench.
 *
 * Draft text lives in `composerDraftStore` so keystrokes do not re-render the
 * workbench shell. Consumers use setDraft/getDraft (no draft value in return).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { detectAtQueryFromEditor } from "@/lib/atFileQuery";
import { composerEditorKind, ownsComposerDom } from "@/components/composer";
import { shouldProbeComposerLiveDom } from "@/lib/composerLiveProbe";
import {
  detectSlashQueryFromEditor,
  detectSlashRangeOnStored,
} from "@/lib/draftDoc";
import { shouldPollTickVisible } from "@/lib/visibilityPoll";
import type { Attachment } from "@/lib/attachments";
import type { ChatRef } from "@/lib/chatAttach";
import type { ComposerQuote } from "@/lib/composerQuotes";
import type { ComposerAtFileEntry } from "@/components/ComposerAtPanel";
import type { SlashKindFilter, SkillInfo } from "@/lib/slashCatalog";
import type { PromptHistoryScope } from "@/components/PromptHistoryPanel";
import {
  loadRecentPromptHistory,
  type RecentPromptEntry,
} from "@/lib/recentPromptHistory";
import {
  getDraft,
  setDraft as storeSetDraft,
} from "@/lib/composerDraftStore";

export type LiveTokenQuery = {
  present: boolean;
  query: string;
  start: number;
  end: number;
};

export type SlashQueryRange = {
  start: number;
  query: string;
  end: number;
};

const EMPTY_LIVE: LiveTokenQuery = {
  present: false,
  query: "",
  start: 0,
  end: 0,
};

/**
 * Local composer UI state. Send path and Host wiring remain in AppWorkbench.
 * Draft is external-store only — never returned as React state.
 */
/**
 * 光标是否还在输入框里、且窗口可见 —— 编辑器上报的 `@` / slash 查询共用这条判定
 * （失焦或窗口隐藏时不该保留查询，否则用 Tab 移出输入框后面板会常驻）。
 *
 * 内置档 rAF 轮询里那份同样的判定保持原样不动（上游代码，见 tick），因此这里只服务
 * 两个上报入口。
 */
function composerLiveVisible(el: HTMLElement | null): boolean {
  const sel = typeof window === "undefined" ? null : window.getSelection();
  const composerActive = !!(
    el &&
    (document.activeElement === el || el.contains(document.activeElement))
  );
  const selectionInComposer = !!(
    el &&
    sel &&
    sel.rangeCount > 0 &&
    el.contains(sel.anchorNode)
  );
  return shouldProbeComposerLiveDom({
    visibilityState: document.visibilityState,
    composerActive,
    selectionInComposer,
  });
}

export function useComposerController(initialDraft = "") {
  /** Seed store once when a non-empty initial is passed (tests / rare). */
  const seededRef = useRef(false);
  if (!seededRef.current) {
    seededRef.current = true;
    if (initialDraft) storeSetDraft(initialDraft);
  }

  /** Stable store actions (identity never changes). */
  const setDraft = storeSetDraft;

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const [chatAttachments, setChatAttachments] = useState<ChatRef[]>([]);
  const chatAttachmentsRef = useRef(chatAttachments);
  chatAttachmentsRef.current = chatAttachments;
  const [attachChatOpen, setAttachChatOpen] = useState(false);
  const [attachChatFilter, setAttachChatFilter] = useState("");
  const [attachChatActive, setAttachChatActive] = useState(0);
  const attachChatPanelRef = useRef<HTMLDivElement>(null);
  const attachChatOpenRef = useRef(false);
  attachChatOpenRef.current = attachChatOpen;
  const [quotes, setQuotes] = useState<ComposerQuote[]>([]);
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  /**
   * Skip debounced project-draft persist while programmatically loading a
   * saved buffer into the composer (newChat restore).
   */
  const suppressProjectDraftPersistRef = useRef(false);

  /**
   * CLI-like prompt history browse index (0 = newest user msg).
   * null = not browsing; only engaged when draft empty (or already browsing).
   */
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | null>(
    null,
  );
  const promptHistoryIndexRef = useRef<number | null>(null);
  promptHistoryIndexRef.current = promptHistoryIndex;

  /**
   * `/history` + empty-↑ picker — session tab (Build) + cross-session recent.
   */
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);
  const [promptHistoryFilter, setPromptHistoryFilter] = useState("");
  const [promptHistoryActive, setPromptHistoryActive] = useState(0);
  const [promptHistoryFocusFilter, setPromptHistoryFocusFilter] =
    useState(false);
  const [promptHistoryScope, setPromptHistoryScope] =
    useState<PromptHistoryScope>("session");
  const promptHistoryScopeRef = useRef<PromptHistoryScope>("session");
  promptHistoryScopeRef.current = promptHistoryScope;
  const [recentPromptHistory, setRecentPromptHistory] = useState<
    RecentPromptEntry[]
  >(() =>
    typeof localStorage !== "undefined" ? loadRecentPromptHistory() : [],
  );
  /** Clear recent prompts — App-level GlassModal (avoids floating-menu dismiss). */
  const [promptHistoryClearOpen, setPromptHistoryClearOpen] = useState(false);
  const promptHistoryPanelRef = useRef<HTMLDivElement>(null);
  const promptHistoryOpenRef = useRef(false);
  promptHistoryOpenRef.current = promptHistoryOpen;

  const [skillInfos, setSkillInfos] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  /** Host `skills_list` error (CLI missing / inspect fail); empty when ok. */
  const [skillsLoadError, setSkillsLoadError] = useState<string | null>(null);

  const [slashQuery, setSlashQuery] = useState<SlashQueryRange | null>(null);
  /**
   * Live slash token from stored-form DOM walk (rAF poll; paused while hidden
   * or while the selection is outside the composer). Independent of React draft
   * so IME / <br> / missed onChange cannot desync.
   */
  const [liveSlash, setLiveSlash] = useState<LiveTokenQuery>(EMPTY_LIVE);
  const liveSlashRef = useRef(liveSlash);
  liveSlashRef.current = liveSlash;
  /** After Escape, suppress re-open until the `/token` text changes. */
  const slashDismissedSigRef = useRef<string | null>(null);
  const showComposerPlusRef = useRef(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  /** Kind chip for slash / + palette (`all` | mode | action | prompt | skill). */
  const [slashKindFilter, setSlashKindFilter] =
    useState<SlashKindFilter>("all");

  /**
   * Live `@` file token (rAF, same source as slash).
   * Suppressed while slash/plus menu is open (slash wins).
   */
  const [liveAt, setLiveAt] = useState<LiveTokenQuery>(EMPTY_LIVE);
  const liveAtRef = useRef(liveAt);
  liveAtRef.current = liveAt;
  const atDismissedSigRef = useRef<string | null>(null);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atEntries, setAtEntries] = useState<ComposerAtFileEntry[]>([]);
  const [atLoading, setAtLoading] = useState(false);
  const [atSoftFail, setAtSoftFail] = useState<string | null>(null);
  const atPanelRef = useRef<HTMLDivElement>(null);
  const atSearchGenRef = useRef(0);

  const [showComposerPlus, setShowComposerPlus] = useState(false);
  showComposerPlusRef.current = showComposerPlus;
  const composerPlusTriggerRef = useRef<HTMLButtonElement>(null);
  const composerPlusPanelRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLDivElement>(null);
  /** Actual input card (.composer) — command panel anchors here. */
  const composerShellRef = useRef<HTMLDivElement>(null);
  /** Floating composer shell — height drives chat bottom padding. */
  const [composerFloatPad, setComposerFloatPad] = useState(168);

  /**
   * rAF poll → live slash / @ tokens.
   * Pause while hidden or while the selection is outside the composer.
   */
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      raf = 0;
      if (!shouldPollTickVisible(document.visibilityState)) return;
      const el = composerInputRef.current;
      // Markdown 档：`@` / slash 的查询由编辑器按文档位置上报（reportAtQuery /
      // onSlashQueryChange），DOM 轮询整体让位，避免两套坐标互相覆盖。
      if (ownsComposerDom(el)) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const sel = window.getSelection();
      const composerActive = !!(
        el &&
        (document.activeElement === el || el.contains(document.activeElement))
      );
      const selectionInComposer = !!(
        el &&
        sel &&
        sel.rangeCount > 0 &&
        el.contains(sel.anchorNode)
      );
      const probeDom = shouldProbeComposerLiveDom({
        visibilityState: document.visibilityState,
        composerActive,
        selectionInComposer,
      });
      const detected = probeDom
        ? (detectSlashQueryFromEditor(el) ??
          detectSlashRangeOnStored(getDraft()))
        : detectSlashRangeOnStored(getDraft());
      let next = detected
        ? {
            present: true as const,
            query: detected.query,
            start: detected.start,
            end: detected.end,
          }
        : {
            present: false as const,
            query: "",
            start: 0,
            end: 0,
          };
      if (next.present && slashDismissedSigRef.current != null) {
        const sig = `${next.start}:${next.query}`;
        if (sig === slashDismissedSigRef.current) {
          next = { present: false, query: "", start: 0, end: 0 };
        } else {
          slashDismissedSigRef.current = null;
        }
      }
      if (!next.present && detected == null) {
        slashDismissedSigRef.current = null;
      }
      const prev = liveSlashRef.current;
      if (
        prev.present !== next.present ||
        prev.query !== next.query ||
        prev.start !== next.start ||
        prev.end !== next.end
      ) {
        liveSlashRef.current = next;
        setLiveSlash(next);
        if (next.present) {
          setSlashQuery({
            start: next.start,
            query: next.query,
            end: next.end,
          });
        } else if (!showComposerPlusRef.current) {
          setSlashQuery((q) => (q == null ? q : null));
        }
      }
      let atNext: LiveTokenQuery = {
        present: false,
        query: "",
        start: 0,
        end: 0,
      };
      if (probeDom && !next.present && !showComposerPlusRef.current) {
        const atDetected = detectAtQueryFromEditor(el);
        if (atDetected) {
          atNext = {
            present: true,
            query: atDetected.query,
            start: atDetected.start,
            end: atDetected.end,
          };
          if (atDismissedSigRef.current != null) {
            const sig = `${atNext.start}:${atNext.query}`;
            if (sig === atDismissedSigRef.current) {
              atNext = { present: false, query: "", start: 0, end: 0 };
            } else {
              atDismissedSigRef.current = null;
            }
          }
        } else {
          atDismissedSigRef.current = null;
        }
      }
      const prevAt = liveAtRef.current;
      if (
        prevAt.present !== atNext.present ||
        prevAt.query !== atNext.query ||
        prevAt.start !== atNext.start ||
        prevAt.end !== atNext.end
      ) {
        liveAtRef.current = atNext;
        setLiveAt(atNext);
        if (atNext.present) setAtActiveIndex(0);
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!alive || raf) return;
      raf = requestAnimationFrame(tick);
    };
    const onVis = () => {
      if (!shouldPollTickVisible(document.visibilityState)) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        return;
      }
      start();
    };
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /**
   * `@` 查询上报（Markdown 档）：由 ComposerEditor 在文档 / 选区变化时按文档位置
   * 算出区间后调用。取代内置档的 DOM walk：抑制逻辑（slash / `+` 菜单打开时不
   * 触发）由消费方的 `composerMenuOpen` 承担，这里只做去重、Escape 抑制比对与
   * 状态落库。
   */
  const reportAtQuery = useCallback(
    (range: { from: number; to: number; query: string } | null) => {
      // 失焦 / 窗口隐藏时不保留查询：与内置档的 probeDom 语义一致，否则用 Tab
      // 移出输入框后 `@` 面板会常驻。
      if (!composerLiveVisible(composerInputRef.current)) {
        range = null;
      }
      let atNext: LiveTokenQuery = {
        present: false,
        query: "",
        start: 0,
        end: 0,
      };
      if (range) {
        atNext = {
          present: true,
          query: range.query,
          start: range.from,
          end: range.to,
        };
        const sig = `${atNext.start}:${atNext.query}`;
        if (sig === atDismissedSigRef.current) {
          atNext = { present: false, query: "", start: 0, end: 0 };
        } else {
          atDismissedSigRef.current = null;
        }
      } else {
        atDismissedSigRef.current = null;
      }
      const prevAt = liveAtRef.current;
      if (
        prevAt.present !== atNext.present ||
        prevAt.query !== atNext.query ||
        prevAt.start !== atNext.start ||
        prevAt.end !== atNext.end
      ) {
        liveAtRef.current = atNext;
        setLiveAt(atNext);
        if (atNext.present) setAtActiveIndex(0);
      }
    },
    [],
  );

  /**
   * slash 查询上报（Markdown 档）：内置档的 DOM 轮询在 TipTap 托管时整体让位，
   * `liveSlash` / `slashQuery` 改由编辑器上报的区间驱动，去重与 Escape 抑制比对
   * 规则与轮询版一致。
   */
  const reportSlashQuery = useCallback(
    (range: { start: number; query: string; end: number } | null) => {
      const live = !!range && composerLiveVisible(composerInputRef.current);
      let next: LiveTokenQuery = live
        ? { present: true, query: range.query, start: range.start, end: range.end }
        : { present: false, query: "", start: 0, end: 0 };
      if (next.present && slashDismissedSigRef.current != null) {
        const sig = `${next.start}:${next.query}`;
        if (sig === slashDismissedSigRef.current) {
          next = { present: false, query: "", start: 0, end: 0 };
        } else {
          slashDismissedSigRef.current = null;
        }
      } else if (!next.present) {
        slashDismissedSigRef.current = null;
      }
      const prev = liveSlashRef.current;
      if (
        prev.present !== next.present ||
        prev.query !== next.query ||
        prev.start !== next.start ||
        prev.end !== next.end
      ) {
        liveSlashRef.current = next;
        setLiveSlash(next);
        if (next.present) {
          setSlashQuery({
            start: next.start,
            query: next.query,
            end: next.end,
          });
        } else if (!showComposerPlusRef.current) {
          setSlashQuery((q) => (q == null ? q : null));
        }
      }
    },
    [],
  );

  /**
   * 编辑器上报的 slash 查询（消费方把它透传给编辑器）。
   *
   * 内置档沿用上游语义：DOM 轮询维护 `liveSlash`，这里只把区间同步进 `slashQuery`
   * 并去重。Markdown 档轮询整体让位，上报的区间必须连 `liveSlash` 一起驱动（消费方
   * 读它取落点与过滤词），因此整条交给 {@link reportSlashQuery}。
   */
  const onSlashQueryChange = useCallback(
    (q: SlashQueryRange | null) => {
      if (composerEditorKind() === "tiptap") {
        reportSlashQuery(q);
        return;
      }
      setSlashQuery((prev) => {
        if (q == null) return prev == null ? prev : null;
        if (
          prev &&
          prev.start === q.start &&
          prev.query === q.query &&
          prev.end === q.end
        ) {
          return prev;
        }
        return q;
      });
    },
    [reportSlashQuery],
  );

  return useMemo(
    () => ({
      /** Call-time read; does not subscribe (safe in event handlers / send). */
      getDraft,
      setDraft,
      attachments,
      attachmentsRef,
      setAttachments: setAttachments as Dispatch<
        SetStateAction<Attachment[]>
      >,
      chatAttachments,
      chatAttachmentsRef,
      setChatAttachments: setChatAttachments as Dispatch<
        SetStateAction<ChatRef[]>
      >,
      attachChatOpen,
      setAttachChatOpen,
      attachChatFilter,
      setAttachChatFilter,
      attachChatActive,
      setAttachChatActive,
      attachChatPanelRef,
      attachChatOpenRef,
      quotes,
      quotesRef,
      setQuotes: setQuotes as Dispatch<SetStateAction<ComposerQuote[]>>,
      suppressProjectDraftPersistRef,
      promptHistoryIndex,
      setPromptHistoryIndex,
      promptHistoryIndexRef,
      promptHistoryOpen,
      setPromptHistoryOpen,
      promptHistoryFilter,
      setPromptHistoryFilter,
      promptHistoryActive,
      setPromptHistoryActive,
      promptHistoryFocusFilter,
      setPromptHistoryFocusFilter,
      promptHistoryScope,
      setPromptHistoryScope,
      promptHistoryScopeRef,
      recentPromptHistory,
      setRecentPromptHistory,
      promptHistoryClearOpen,
      setPromptHistoryClearOpen,
      promptHistoryPanelRef,
      promptHistoryOpenRef,
      skillInfos,
      setSkillInfos,
      skillsLoading,
      setSkillsLoading,
      skillsLoadError,
      setSkillsLoadError,
      slashQuery,
      setSlashQuery,
      liveSlash,
      setLiveSlash,
      liveSlashRef,
      slashDismissedSigRef,
      slashActiveIndex,
      setSlashActiveIndex,
      slashKindFilter,
      setSlashKindFilter,
      liveAt,
      setLiveAt,
      liveAtRef,
      atDismissedSigRef,
      reportAtQuery,
      onSlashQueryChange,
      atActiveIndex,
      setAtActiveIndex,
      atEntries,
      setAtEntries,
      atLoading,
      setAtLoading,
      atSoftFail,
      setAtSoftFail,
      atPanelRef,
      atSearchGenRef,
      showComposerPlus,
      setShowComposerPlus,
      composerPlusTriggerRef,
      composerPlusPanelRef,
      composerInputRef,
      composerShellRef,
      composerFloatPad,
      setComposerFloatPad,
      // Legacy alias names used by earlier stub consumers
      slashOpen: showComposerPlus || liveSlash.present || !!slashQuery,
      setSlashOpen: setShowComposerPlus,
      atOpen: liveAt.present,
      setAtOpen: (_v: boolean) => {
        if (!_v) {
          setLiveAt(EMPTY_LIVE);
        }
      },
      plusOpen: showComposerPlus,
      setPlusOpen: setShowComposerPlus,
    }),
    [
      attachments,
      chatAttachments,
      attachChatOpen,
      attachChatFilter,
      attachChatActive,
      quotes,
      promptHistoryIndex,
      promptHistoryOpen,
      promptHistoryFilter,
      promptHistoryActive,
      promptHistoryFocusFilter,
      promptHistoryScope,
      recentPromptHistory,
      promptHistoryClearOpen,
      skillInfos,
      skillsLoading,
      skillsLoadError,
      slashQuery,
      liveSlash,
      slashActiveIndex,
      slashKindFilter,
      liveAt,
      atActiveIndex,
      atEntries,
      atLoading,
      atSoftFail,
      showComposerPlus,
      composerFloatPad,
    ],
  );
}
