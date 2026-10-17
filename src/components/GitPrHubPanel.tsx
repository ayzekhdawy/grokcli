/**
 * Settings → Runtime → Tools: project-level GitHub PR hub
 * (`gh pr list` / `gh pr checks` / `gh pr view` comments). Soft-fails when gh/git missing.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  classifyPrHubReason,
  formatChecksSummaryLine,
  normalizeMergeable,
  summarizeChecks,
  type GitPrCheckEntry,
  type GitPrCommentEntry,
  type GitPrHubEntry,
  type PrChecksSummary,
} from "@/lib/gitPrHub";
import {
  isHighlightedPr,
  sanitizePrNumber,
} from "@/lib/prHubDeepLink";
import {
  buildFixCiPrompt,
  buildPrCommentPrompt,
  canSuggestFixCi,
  listFailedChecks,
} from "@/lib/prReviewWorkbench";
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconRefresh,
} from "@/components/icons";

export interface GitPrHubPanelProps {
  locale: Locale;
  /** Active workbench project path (gh cwd). */
  projectPath?: string | null;
  /** When true, omit title/desc (parent card already shows them). */
  hideHeader?: boolean;
  /**
   * Optional PR number to expand + highlight (ship deep link / `?pr=`).
   * Soft-no-op when the number is missing from the current list.
   */
  highlightPrNumber?: number | null;
  /**
   * Insert a Fix-CI / comment prompt into the workbench composer.
   * When omitted, "Fix with Grok" / "Ask Grok" action buttons stay hidden
   * (honest: no silent no-op).
   */
  onDraftToChat?: (prompt: string) => void;
}

function ChecksBadge({
  summary,
  tr,
}: {
  summary: PrChecksSummary | null | undefined;
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  if (!summary || summary.total <= 0) {
    return (
      <span className="pr-hub__badge pr-hub__badge--muted">
        {tr("prHub.checks.none")}
      </span>
    );
  }
  const line = formatChecksSummaryLine(summary);
  const tone =
    summary.overall === "fail"
      ? "fail"
      : summary.overall === "pending"
        ? "pending"
        : summary.overall === "pass"
          ? "pass"
          : "muted";
  return (
    <span
      className={`pr-hub__badge pr-hub__badge--${tone}`}
      title={line || undefined}
    >
      {line || tr("prHub.checks.none")}
    </span>
  );
}

function MergeableBadge({
  mergeable,
  tr,
}: {
  mergeable: string | null | undefined;
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const m = normalizeMergeable(mergeable);
  if (!m) return null;
  if (m === "mergeable") {
    return (
      <span className="pr-hub__badge pr-hub__badge--pass">
        {tr("prHub.mergeable")}
      </span>
    );
  }
  if (m === "conflicting") {
    return (
      <span className="pr-hub__badge pr-hub__badge--fail">
        {tr("prHub.conflicting")}
      </span>
    );
  }
  return (
    <span className="pr-hub__badge pr-hub__badge--muted">
      {tr("prHub.mergeableUnknown")}
    </span>
  );
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body?: string | null;
}) {
  return (
    <div className="pi-empty pr-hub__empty" role="status">
      <div className="pi-empty__title">{title}</div>
      {body ? <p className="pi-empty__body">{body}</p> : null}
    </div>
  );
}

function reviewStateLabel(
  state: string | null | undefined,
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string | null {
  const s = (state ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "APPROVED") return tr("prHub.review.approved");
  if (s === "CHANGES_REQUESTED") return tr("prHub.review.changesRequested");
  if (s === "COMMENTED") return tr("prHub.review.commented");
  if (s === "DISMISSED") return tr("prHub.review.dismissed");
  return state ?? null;
}

function ChecksDetail({
  checks,
  loading,
  error,
  tr,
}: {
  checks: GitPrCheckEntry[] | null;
  loading: boolean;
  error: string | null;
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  if (loading) {
    return (
      <div className="pr-hub__section-body pr-hub__muted">
        {tr("prHub.checks.loading")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="pr-hub__section-body pr-hub__error" role="alert">
        {error}
      </div>
    );
  }
  if (!checks || checks.length === 0) {
    return (
      <div className="pr-hub__section-body pr-hub__muted">
        {tr("prHub.checks.none")}
      </div>
    );
  }
  return (
    <div className="pr-hub__section-body">
      <table className="pr-hub__checks-table">
        <thead>
          <tr>
            <th scope="col">{tr("prHub.checks.colName")}</th>
            <th scope="col">{tr("prHub.checks.colState")}</th>
            <th scope="col" className="pr-hub__checks-col-link">
              <span className="sr-only">{tr("prHub.openCheck")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={`${c.name}:${c.workflow ?? ""}:${c.state}`}>
              <td className="pr-hub__check-name-cell">
                <span
                  className={`pr-hub__check-dot pr-hub__check-dot--${c.bucket || "muted"}`}
                  aria-hidden
                />
                <span className="pr-hub__check-name" title={c.name}>
                  {c.name}
                </span>
                {c.workflow ? (
                  <span className="pr-hub__check-workflow">{c.workflow}</span>
                ) : null}
              </td>
              <td className="pr-hub__check-state">{c.state || c.bucket}</td>
              <td className="pr-hub__checks-col-link">
                {c.link ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm pr-hub__check-link"
                    onClick={() => void openUrl(c.link!)}
                    title={c.link}
                    aria-label={tr("prHub.openCheck")}
                  >
                    <IconExternalLink size={12} />
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommentsDetail({
  comments,
  loading,
  error,
  conversationUrl,
  tr,
  onAskGrok,
}: {
  comments: GitPrCommentEntry[] | null;
  loading: boolean;
  error: string | null;
  conversationUrl?: string | null;
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Per-row Ask Grok; omit to hide action buttons. */
  onAskGrok?: (comment: GitPrCommentEntry) => void;
}) {
  if (loading) {
    return (
      <div className="pr-hub__section-body pr-hub__muted">
        {tr("prHub.comments.loading")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="pr-hub__section-body pr-hub__error" role="alert">
        {error}
      </div>
    );
  }
  if (!comments || comments.length === 0) {
    return (
      <div className="pr-hub__section-body pr-hub__muted">
        {tr("prHub.comments.none")}
      </div>
    );
  }
  return (
    <div className="pr-hub__section-body">
      <ul className="pr-hub__comments-list">
        {comments.map((c) => {
          const stateLabel =
            c.kind === "review" ? reviewStateLabel(c.state, tr) : null;
          const openTarget = c.url || conversationUrl || null;
          const canAsk =
            typeof onAskGrok === "function" && Boolean(c.body?.trim());
          return (
            <li key={c.id} className="pr-hub__comment-row">
              <div className="pr-hub__comment-head">
                <span className="pr-hub__comment-author">
                  {c.author || tr("prHub.comments.unknownAuthor")}
                </span>
                {c.kind === "review" ? (
                  <span className="pr-hub__badge pr-hub__badge--muted">
                    {stateLabel || tr("prHub.comments.review")}
                  </span>
                ) : (
                  <span className="pr-hub__badge pr-hub__badge--muted">
                    {tr("prHub.comments.comment")}
                  </span>
                )}
                <span className="pr-hub__comment-actions">
                  {canAsk ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm pr-hub__ask-grok"
                      onClick={() => onAskGrok?.(c)}
                      title={tr("prHub.comments.askGrokTitle")}
                      aria-label={tr("prHub.comments.askGrok")}
                    >
                      {tr("prHub.comments.askGrok")}
                    </button>
                  ) : null}
                  {openTarget ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm pr-hub__comment-link"
                      onClick={() => void openUrl(openTarget)}
                      title={openTarget}
                      aria-label={tr("prHub.comments.open")}
                    >
                      <IconExternalLink size={12} />
                    </button>
                  ) : null}
                </span>
              </div>
              <p className="pr-hub__comment-excerpt" title={c.body || undefined}>
                {c.excerpt || tr("prHub.comments.emptyBody")}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

async function openUrl(url: string) {
  const u = url.trim();
  if (!u) return;
  if (api.isTauri()) {
    await api.openExternalUrl(u);
  } else {
    window.open(u, "_blank", "noopener,noreferrer");
  }
}

export function GitPrHubPanel({
  locale,
  projectPath = null,
  hideHeader = false,
  highlightPrNumber = null,
  onDraftToChat,
}: GitPrHubPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const cwd = projectPath?.trim() || null;
  const highlightN = sanitizePrNumber(highlightPrNumber);
  const canDraft = typeof onDraftToChat === "function";

  const [prs, setPrs] = useState<GitPrHubEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [ghFound, setGhFound] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [checksByPr, setChecksByPr] = useState<
    Record<number, GitPrCheckEntry[] | null>
  >({});
  const [checksLoading, setChecksLoading] = useState<Record<number, boolean>>(
    {},
  );
  const [checksError, setChecksError] = useState<Record<number, string | null>>(
    {},
  );
  const [commentsByPr, setCommentsByPr] = useState<
    Record<number, GitPrCommentEntry[] | null>
  >({});
  const [commentsLoading, setCommentsLoading] = useState<
    Record<number, boolean>
  >({});
  const [commentsError, setCommentsError] = useState<
    Record<number, string | null>
  >({});
  const [conversationUrlByPr, setConversationUrlByPr] = useState<
    Record<number, string | null>
  >({});
  /** Avoid re-scrolling the same highlight on every refresh. */
  const scrolledHighlightRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!cwd) {
      setPrs([]);
      setError(null);
      setReason(null);
      setAvailable(null);
      setLoading(false);
      return;
    }
    if (!api.isTauri()) {
      setPrs([]);
      setError(tr("prHub.needTauri"));
      setAvailable(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setReason(null);
    try {
      const res = await api.gitPrList(cwd, { limit: 30, state: "open" });
      setGhFound(res.ghFound !== false);
      setAvailable(res.available);
      setPrs(Array.isArray(res.prs) ? res.prs : []);
      if (!res.available) {
        setReason(res.reason?.trim() || null);
      } else {
        setReason(null);
      }
    } catch (e) {
      setPrs([]);
      setAvailable(false);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd, tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setExpanded({});
    setChecksByPr({});
    setChecksLoading({});
    setChecksError({});
    setCommentsByPr({});
    setCommentsLoading({});
    setCommentsError({});
    setConversationUrlByPr({});
    scrolledHighlightRef.current = null;
  }, [cwd]);

  const loadChecks = useCallback(
    async (n: number) => {
      if (!cwd || !api.isTauri()) return;
      setChecksLoading((prev) => ({ ...prev, [n]: true }));
      setChecksError((prev) => ({ ...prev, [n]: null }));
      try {
        const res = await api.gitPrChecks(cwd, n);
        if (!res.available) {
          setChecksByPr((prev) => ({ ...prev, [n]: [] }));
          setChecksError((prev) => ({
            ...prev,
            [n]: res.reason?.trim() || tr("prHub.checks.failed"),
          }));
          return;
        }
        setChecksByPr((prev) => ({
          ...prev,
          [n]: Array.isArray(res.checks) ? res.checks : [],
        }));
      } catch (e) {
        setChecksError((prev) => ({
          ...prev,
          [n]: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setChecksLoading((prev) => ({ ...prev, [n]: false }));
      }
    },
    [cwd, tr],
  );

  const loadComments = useCallback(
    async (n: number) => {
      if (!cwd || !api.isTauri()) return;
      setCommentsLoading((prev) => ({ ...prev, [n]: true }));
      setCommentsError((prev) => ({ ...prev, [n]: null }));
      try {
        const res = await api.gitPrComments(cwd, n);
        if (!res.available) {
          setCommentsByPr((prev) => ({ ...prev, [n]: [] }));
          setCommentsError((prev) => ({
            ...prev,
            [n]: res.reason?.trim() || tr("prHub.comments.failed"),
          }));
          setConversationUrlByPr((prev) => ({ ...prev, [n]: null }));
          return;
        }
        setCommentsByPr((prev) => ({
          ...prev,
          [n]: Array.isArray(res.comments) ? res.comments : [],
        }));
        setConversationUrlByPr((prev) => ({
          ...prev,
          [n]: res.url?.trim() || null,
        }));
      } catch (e) {
        setCommentsError((prev) => ({
          ...prev,
          [n]: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setCommentsLoading((prev) => ({ ...prev, [n]: false }));
      }
    },
    [cwd, tr],
  );
  // Deep-link / ship: expand + scroll to highlighted PR when it appears.
  // Soft-no-op if the number is absent from the open list (just-created PR may
  // lag gh list briefly — user can Refresh).
  useEffect(() => {
    if (highlightN == null) {
      scrolledHighlightRef.current = null;
      return;
    }
    const found = prs.some((p) => p.number === highlightN);
    if (!found) return;
    setExpanded((prev) => {
      if (prev[highlightN]) return prev;
      return { ...prev, [highlightN]: true };
    });
    if (checksByPr[highlightN] === undefined) {
      void loadChecks(highlightN);
    }
    if (scrolledHighlightRef.current === highlightN) return;
    scrolledHighlightRef.current = highlightN;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`pr-hub-row-${highlightN}`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [highlightN, prs, checksByPr, loadChecks]);

  const toggleExpand = (n: number) => {
    setExpanded((prev) => {
      const next = !prev[n];
      if (next) {
        if (checksByPr[n] === undefined) void loadChecks(n);
        if (commentsByPr[n] === undefined) void loadComments(n);
      }
      return { ...prev, [n]: next };
    });
  };

  const draftFixCi = useCallback(
    (pr: GitPrHubEntry) => {
      if (!canDraft || !onDraftToChat) return;
      const loaded = checksByPr[pr.number];
      const failed = listFailedChecks(loaded ?? []);
      const prompt = buildFixCiPrompt({
        prNumber: pr.number,
        title: pr.title || "",
        url: pr.url || null,
        headRef: pr.headRefName ?? null,
        baseRef: pr.baseRefName ?? null,
        failedChecks: failed.map((c) => ({
          name: c.name,
          state: c.state || c.bucket,
          description: c.description ?? null,
        })),
        bodyExcerpt: pr.body ?? null,
      });
      if (!prompt.trim()) return;
      onDraftToChat(prompt);
    },
    [canDraft, onDraftToChat, checksByPr],
  );

  const draftComment = useCallback(
    (pr: GitPrHubEntry, comment: GitPrCommentEntry) => {
      if (!canDraft || !onDraftToChat) return;
      const prompt = buildPrCommentPrompt({
        prNumber: pr.number,
        title: pr.title || "",
        comment: {
          author: comment.author || "",
          body: comment.body || "",
          kind: comment.kind,
          state: comment.state ?? null,
          url: comment.url ?? null,
        },
      });
      if (!prompt.trim()) return;
      onDraftToChat(prompt);
    },
    [canDraft, onDraftToChat],
  );

  const reasonKind = classifyPrHubReason(reason);
  const softMessage = (() => {
    if (!cwd) {
      return {
        title: tr("prHub.needProject"),
        body: tr("prHub.needProjectBody"),
      };
    }
    if (error) {
      return { title: tr("prHub.error"), body: error };
    }
    if (available === false) {
      if (reasonKind === "no_gh" || !ghFound) {
        return {
          title: tr("prHub.needGh"),
          body: reason || tr("prHub.needGhBody"),
        };
      }
      if (reasonKind === "no_git") {
        return {
          title: tr("prHub.needGit"),
          body: reason || tr("prHub.needGitBody"),
        };
      }
      if (reasonKind === "not_repo") {
        return {
          title: tr("prHub.notGit"),
          body: reason || tr("prHub.notGitBody"),
        };
      }
      return {
        title: tr("prHub.unavailable"),
        body: reason || tr("prHub.unavailableBody"),
      };
    }
    return null;
  })();

  let body: ReactNode;
  if (!cwd || softMessage) {
    body = softMessage ? (
      <EmptyState title={softMessage.title} body={softMessage.body} />
    ) : null;
  } else if (loading && prs.length === 0) {
    body = (
      <div className="pr-hub__muted" role="status">
        {tr("prHub.loading")}
      </div>
    );
  } else if (prs.length === 0) {
    body = (
      <EmptyState title={tr("prHub.empty")} body={tr("prHub.emptyBody")} />
    );
  } else {
    body = (
      <ul className="pr-hub__list" data-testid="pr-hub-list">
        {prs.map((pr) => {
          const open = Boolean(expanded[pr.number]);
          const conversationUrl =
            conversationUrlByPr[pr.number] || pr.url || null;
          const highlighted = isHighlightedPr(pr.number, highlightN);
          const loadedChecks = checksByPr[pr.number];
          const effectiveSummary: PrChecksSummary | null | undefined =
            loadedChecks != null && loadedChecks.length > 0
              ? summarizeChecks(loadedChecks)
              : pr.checks;
          const showFixCi =
            canDraft && canSuggestFixCi(effectiveSummary);
          return (
            <li
              key={pr.number}
              id={`pr-hub-row-${pr.number}`}
              className={
                "pr-hub__row" + (highlighted ? " pr-hub__row--highlight" : "")
              }
              data-highlighted={highlighted ? "true" : undefined}
            >
              <div className="pr-hub__row-main">
                <button
                  type="button"
                  className="pr-hub__expand"
                  onClick={() => toggleExpand(pr.number)}
                  aria-expanded={open}
                  title={
                    open ? tr("prHub.collapseDetails") : tr("prHub.expandDetails")
                  }
                >
                  {open ? (
                    <IconChevronDown size={14} />
                  ) : (
                    <IconChevronRight size={14} />
                  )}
                </button>
                <div className="pr-hub__meta">
                  <div className="pr-hub__title-line">
                    <span className="pr-hub__number">#{pr.number}</span>
                    <span className="pr-hub__title" title={pr.title}>
                      {pr.title || tr("prHub.untitled")}
                    </span>
                    {pr.isDraft ? (
                      <span className="pr-hub__badge pr-hub__badge--muted">
                        {tr("prHub.draft")}
                      </span>
                    ) : null}
                  </div>
                  <div className="pr-hub__sub">
                    {pr.author ? (
                      <span className="pr-hub__author">
                        {tr("prHub.author", { name: pr.author })}
                      </span>
                    ) : null}
                    {pr.headRefName ? (
                      <span className="pr-hub__branch" title={pr.headRefName}>
                        {pr.headRefName}
                        {pr.baseRefName ? ` → ${pr.baseRefName}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="pr-hub__badges">
                    <MergeableBadge mergeable={pr.mergeable} tr={tr} />
                    <ChecksBadge summary={pr.checks} tr={tr} />
                  </div>
                </div>
                <div className="pr-hub__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!pr.url}
                    onClick={() => void openUrl(pr.url)}
                    title={tr("prHub.openInBrowser")}
                    aria-label={tr("prHub.openInBrowser")}
                  >
                    <IconExternalLink size={14} />
                    <span>{tr("prHub.open")}</span>
                  </button>
                </div>
              </div>
              {open ? (
                <div className="pr-hub__detail">
                  <section className="pr-hub__section">
                    <div className="pr-hub__section-head">
                      <h4 className="pr-hub__section-title">
                        {tr("prHub.checks.title")}
                      </h4>
                      {showFixCi ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm pr-hub__fix-ci"
                          onClick={() => draftFixCi(pr)}
                          title={tr("prHub.checks.fixCiTitle")}
                          aria-label={tr("prHub.checks.fixCi")}
                          data-testid={`pr-hub-fix-ci-${pr.number}`}
                        >
                          {tr("prHub.checks.fixCi")}
                        </button>
                      ) : null}
                    </div>
                    <ChecksDetail
                      checks={checksByPr[pr.number] ?? null}
                      loading={Boolean(checksLoading[pr.number])}
                      error={checksError[pr.number] ?? null}
                      tr={tr}
                    />
                  </section>
                  <section className="pr-hub__section">
                    <div className="pr-hub__section-head">
                      <h4 className="pr-hub__section-title">
                        {tr("prHub.comments.title")}
                      </h4>
                      {conversationUrl ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => void openUrl(conversationUrl)}
                          title={tr("prHub.openConversation")}
                          aria-label={tr("prHub.openConversation")}
                        >
                          <IconExternalLink size={12} />
                          <span>{tr("prHub.openConversation")}</span>
                        </button>
                      ) : null}
                    </div>
                    <CommentsDetail
                      comments={commentsByPr[pr.number] ?? null}
                      loading={Boolean(commentsLoading[pr.number])}
                      error={commentsError[pr.number] ?? null}
                      conversationUrl={conversationUrl}
                      tr={tr}
                      onAskGrok={
                        canDraft
                          ? (c) => draftComment(pr, c)
                          : undefined
                      }
                    />
                  </section>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="pr-hub-panel" data-testid="git-pr-hub-panel">
      {!hideHeader ? (
        <div
          className="settings-row settings-row--stack"
          style={{ borderBottom: "none", paddingBottom: 0 }}
        >
          <div className="settings-row__text">
            <div className="settings-row__label">{tr("prHub.title")}</div>
            <div className="settings-row__desc">{tr("prHub.desc")}</div>
          </div>
        </div>
      ) : null}

      <div className="pr-hub__toolbar">
        <div className="pr-hub__toolbar-left">
          {available && prs.length > 0 ? (
            <span className="pr-hub__count">
              {tr("prHub.count", { n: prs.length })}
            </span>
          ) : null}
          {loading && prs.length > 0 ? (
            <span className="pr-hub__muted">{tr("prHub.refreshing")}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void refresh()}
          disabled={loading || !cwd || !api.isTauri()}
          aria-label={tr("prHub.refresh")}
        >
          <IconRefresh size={14} />
          <span>{loading ? tr("prHub.refreshing") : tr("prHub.refresh")}</span>
        </button>
      </div>

      {body}
    </div>
  );
}
