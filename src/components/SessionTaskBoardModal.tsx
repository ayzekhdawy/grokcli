/**
 * Cross-session task board — sessions by status columns.
 * Pure local meta (sessions + liveMap); no invented CI/cloud state.
 */

import { useEffect, useMemo, useState } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { formatRelativeTime } from "@/lib/accountUi";
import type { AgentDashboardStatus } from "@/lib/agentDashboard";
import {
  countTaskBoardColumns,
  filterTaskBoard,
  resolveTaskBoardEmptyState,
  TASK_BOARD_COLUMN_ORDER,
  type TaskBoard,
  type TaskBoardCard,
  type TaskBoardColumn,
} from "@/lib/sessionTaskBoard";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function columnLabel(col: TaskBoardColumn, t: TFn): string {
  switch (col) {
    case "needs_you":
      return t("taskBoard.column.needsYou");
    case "running":
      return t("taskBoard.column.running");
    case "idle":
      return t("taskBoard.column.idle");
    case "done":
      return t("taskBoard.column.done");
    case "error":
      return t("taskBoard.column.error");
  }
}

function statusLabel(status: AgentDashboardStatus, t: TFn): string {
  switch (status) {
    case "busy":
      return t("dashboard.status.busy");
    case "permission":
      return t("dashboard.status.permission");
    case "connecting":
      return t("dashboard.status.connecting");
    case "error":
      return t("dashboard.status.error");
    default:
      return t("dashboard.status.idle");
  }
}

function columnToneClass(col: TaskBoardColumn): string {
  switch (col) {
    case "needs_you":
      return "task-board__col--needs";
    case "running":
      return "task-board__col--running";
    case "error":
      return "task-board__col--error";
    case "done":
      return "task-board__col--done";
    default:
      return "task-board__col--idle";
  }
}

function TaskBoardCardView({
  card,
  t,
  locale,
  onSelect,
}: {
  card: TaskBoardCard;
  t: TFn;
  locale: Locale;
  onSelect?: (sessionId: string) => void;
}) {
  const metaParts: string[] = [];
  if (card.projectName) metaParts.push(card.projectName);
  else if (card.projectPath) metaParts.push(card.projectPath);

  const activity =
    card.lastActivityAt > 0
      ? formatRelativeTime(new Date(card.lastActivityAt).toISOString(), locale)
      : null;
  const toolTitle = card.liveToolTitle?.trim() || null;

  return (
    <li
      className={
        "task-board__card" +
        (card.isCurrent ? " is-current" : "") +
        (card.column === "needs_you" ? " is-needs" : "") +
        (card.column === "running" ? " is-running" : "") +
        (card.column === "error" ? " is-error" : "")
      }
    >
      <button
        type="button"
        className="task-board__card-btn"
        onClick={() => onSelect?.(card.sessionId)}
        title={t("dashboard.openSession")}
      >
        <span className="task-board__card-title" title={card.title}>
          {card.title}
        </span>
        {card.isCurrent ? (
          <span className="task-board__card-current">
            {t("dashboard.current")}
          </span>
        ) : null}
        {toolTitle ? (
          <span className="task-board__card-tool" title={toolTitle}>
            <span className="task-board__card-tool-label">
              {t("dashboard.toolLabel")}
            </span>
            <span className="task-board__card-tool-name">{toolTitle}</span>
          </span>
        ) : null}
        {metaParts.length > 0 ? (
          <span className="task-board__card-meta" title={metaParts.join(" · ")}>
            {metaParts.join(" · ")}
          </span>
        ) : null}
        {activity ? (
          <span className="task-board__card-activity">
            {t("dashboard.lastActivity", { time: activity })}
          </span>
        ) : null}
        {card.column === "done" || card.status !== "idle" ? (
          <span className="task-board__card-status">
            {card.column === "done"
              ? t("taskBoard.column.done")
              : statusLabel(card.status, t)}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export type SessionTaskBoardModalProps = {
  open: boolean;
  locale: Locale;
  board: TaskBoard;
  onClose: () => void;
  onSelectSession?: (sessionId: string) => void;
  /** Controlled include-archived chip (parent owns state when provided). */
  includeArchived?: boolean;
  onIncludeArchivedChange?: (include: boolean) => void;
};

export function SessionTaskBoardModal({
  open,
  locale,
  board,
  onClose,
  onSelectSession,
  includeArchived: includeArchivedProp,
  onIncludeArchivedChange,
}: SessionTaskBoardModalProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [query, setQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [localIncludeArchived, setLocalIncludeArchived] = useState(false);

  const includeArchived = includeArchivedProp ?? localIncludeArchived;
  const setIncludeArchived = (v: boolean) => {
    if (onIncludeArchivedChange) onIncludeArchivedChange(v);
    else setLocalIncludeArchived(v);
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      setProjectQuery("");
    }
  }, [open]);

  const totalCounts = useMemo(() => countTaskBoardColumns(board), [board]);

  const filtered = useMemo(
    () => filterTaskBoard(board, { query, projectQuery }),
    [board, query, projectQuery],
  );
  const filteredCounts = useMemo(
    () => countTaskBoardColumns(filtered),
    [filtered],
  );

  const emptyKind = useMemo(
    () =>
      resolveTaskBoardEmptyState({
        totalSessions: totalCounts.total,
        filteredCount: filteredCounts.total,
      }),
    [totalCounts.total, filteredCounts.total],
  );

  const hasActiveFilters =
    query.trim().length > 0 || projectQuery.trim().length > 0;

  const tFn: TFn = (k, vars) => tr(k, vars);

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("taskBoard.title")}
      titleId="session-task-board-title"
      closeLabel={tr("common.close")}
      size="lg"
      className="task-board-modal"
      wrapBody
      bodyClassName="task-board-modal__body"
      footer={
        <div className="task-board-modal__footer">
          <span className="task-board-modal__footer-meta">
            {tr("taskBoard.totalCount", { n: filteredCounts.total })}
          </span>
          <button type="button" className="btn btn--solid" onClick={onClose}>
            {tr("common.close")}
          </button>
        </div>
      }
    >
      <p className="task-board__hint">{tr("taskBoard.hint")}</p>
      <div className="task-board__toolbar">
        <input
          type="search"
          className="settings-input task-board__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("taskBoard.searchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          aria-label={tr("taskBoard.searchPlaceholder")}
        />
        <input
          type="search"
          className="settings-input task-board__search task-board__search--project"
          value={projectQuery}
          onChange={(e) => setProjectQuery(e.target.value)}
          placeholder={tr("taskBoard.projectSearchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          aria-label={tr("taskBoard.projectSearchPlaceholder")}
        />
        <button
          type="button"
          role="switch"
          aria-checked={includeArchived}
          className={
            "task-board__chip" + (includeArchived ? " is-active" : "")
          }
          onClick={() => setIncludeArchived(!includeArchived)}
          title={tr("taskBoard.includeArchivedTitle")}
        >
          {tr("taskBoard.includeArchived")}
        </button>
      </div>

      {emptyKind === "empty" ? (
        <div className="task-board__empty">
          <p className="task-board__empty-title">{tr("taskBoard.empty")}</p>
          <p className="task-board__empty-hint">{tr("taskBoard.emptyHint")}</p>
        </div>
      ) : emptyKind === "filter_empty" ? (
        <div className="task-board__empty">
          <p className="task-board__empty-title">
            {tr("taskBoard.filterEmpty")}
          </p>
          <p className="task-board__empty-hint">
            {tr("taskBoard.filterEmptyHint")}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm task-board__clear-filters"
              onClick={() => {
                setQuery("");
                setProjectQuery("");
              }}
            >
              {tr("taskBoard.clearFilters")}
            </button>
          ) : null}
        </div>
      ) : (
        <div
          className="task-board__columns"
          role="list"
          aria-label={tr("taskBoard.columnsLabel")}
        >
          {TASK_BOARD_COLUMN_ORDER.map((col) => {
            const cards = filtered[col];
            // Hide empty done column when archived not included and empty.
            if (col === "done" && cards.length === 0 && !includeArchived) {
              return null;
            }
            return (
              <section
                key={col}
                className={"task-board__col " + columnToneClass(col)}
                role="listitem"
                aria-label={columnLabel(col, tFn)}
              >
                <header className="task-board__col-head">
                  <span className="task-board__col-title">
                    {columnLabel(col, tFn)}
                  </span>
                  <span className="task-board__col-count">{cards.length}</span>
                </header>
                {cards.length === 0 ? (
                  <p className="task-board__col-empty">
                    {tr("taskBoard.columnEmpty")}
                  </p>
                ) : (
                  <ul className="task-board__cards" role="list">
                    {cards.map((card) => (
                      <TaskBoardCardView
                        key={card.sessionId}
                        card={card}
                        t={tFn}
                        locale={locale}
                        onSelect={(id) => {
                          onSelectSession?.(id);
                          onClose();
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </GlassModal>
  );
}
