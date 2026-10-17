/**
 * Sidebar remote sessions: host → cwd folder → same tree-l3 row as local chats.
 */
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { GlassModal } from "@/components/GlassModal";
import { SidebarSessionName } from "@/components/SidebarSessionName";
import { SidebarSessionRelativeTime } from "@/components/SidebarSessionRelativeTime";
import { SidebarTreeReveal } from "@/components/SidebarTreeReveal";
import {
  IconCheck,
  IconFolder,
  IconListCheck,
  IconMore,
  IconRename,
  IconNewChat as IconSquarePen,
  IconTrash,
} from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { Tip } from "@/components/ui/tooltip";
import type { Locale, MessageKey, Vars } from "@/i18n";
import * as api from "@/lib/api";
import {
  areAllIdsSelected,
  isSelectModifierEvent,
  rangeIdsInclusive,
  toggleIdInSet,
  toggleIdsInSet,
} from "@/lib/sessionSelect";
import { nextSessionTitle } from "@/lib/sidebarSessionRename";
import {
  groupRemoteSessionsByCwd,
  remainingRemoteCount,
  remotePathTip,
  remoteSessionLabel,
  remoteTitleKey,
} from "@/lib/sshRemoteSessionDisplay";
import { useSshWatch } from "@/providers/SshWatchProvider";

type TFn = (k: MessageKey, vars?: Vars) => string;

type Props = {
  t: TFn;
  locale: Locale;
  showRelativeTime: boolean;
  onOpenSession: (sessionId: string) => void;
  onNewConversation?: (alias: string, cwd: string) => void;
  onImportedSessionsChanged?: () => void;
};

type RemoteMenu = {
  x: number;
  y: number;
  alias: string;
  id: string;
  key: string;
  label: string;
};

type RemoteDeleteTarget = {
  alias: string;
  items: Array<{ id: string; label: string }>;
};

function pathFoldKey(alias: string, cwd: string): string {
  return `${alias}\t${cwd}`;
}

export function SshRemoteSessionRail({
  t,
  locale,
  showRelativeTime,
  onOpenSession,
  onNewConversation,
  onImportedSessionsChanged,
}: Props) {
  const watch = useSshWatch();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [hostOpen, setHostOpen] = useState<Record<string, boolean>>({});
  const [pathOpen, setPathOpen] = useState<Record<string, boolean>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectAnchor, setSelectAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<RemoteMenu | null>(null);
  const [confirm, setConfirm] = useState<RemoteDeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Cmd/Ctrl mousedown already toggled — ignore the following click. */
  const modSelectLockRef = useRef(false);

  const orderedKeys = useMemo(() => {
    const keys: string[] = [];
    for (const alias of watch.watchAliases) {
      const groups = groupRemoteSessionsByCwd(watch.sessionsByAlias[alias] ?? []);
      for (const g of groups) {
        for (const s of g.sessions) keys.push(remoteTitleKey(alias, s.id));
      }
    }
    return keys;
  }, [watch.watchAliases, watch.sessionsByAlias]);

  if (watch.watchAliases.length === 0) return null;

  const untitled = t("sidebar.remoteUntitled");
  const liveKeys = new Set(orderedKeys);
  const prunedSelected = [...selectedKeys].filter((k) => liveKeys.has(k));
  const selectedLive = new Set(prunedSelected);

  const commitRename = (alias: string, id: string, current: string) => {
    const next = nextSessionTitle(draft, current);
    setEditingKey(null);
    if (next) watch.renameRemoteSession(alias, id, next);
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedKeys(new Set());
    setSelectAnchor(null);
  };

  const toggleSelect = (key: string, opts?: { shiftKey?: boolean }) => {
    setSelectMode(true);
    if (opts?.shiftKey && selectAnchor) {
      const range = rangeIdsInclusive(orderedKeys, selectAnchor, key);
      if (range.length > 0) {
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (const id of range) next.add(id);
          return next;
        });
        return;
      }
    }
    setSelectedKeys((prev) => toggleIdInSet(prev, key));
    setSelectAnchor(key);
  };

  const parseRemoteKey = (key: string): { alias: string; id: string } | null => {
    const at = key.indexOf(":");
    if (at <= 0) return null;
    return { alias: key.slice(0, at), id: key.slice(at + 1) };
  };

  const askDelete = (alias: string, items: Array<{ id: string; label: string }>) => {
    if (items.length === 0) return;
    setMenu(null);
    setConfirm({ alias, items });
  };

  const runDelete = async () => {
    if (!confirm || deleting) return;
    setDeleting(true);
    try {
      const r = await api.sshDeleteSessions(
        confirm.alias,
        confirm.items.map((x) => x.id),
      );
      if (!r.ok) {
        setOpenError(
          t("sidebar.remoteOpenFailed", {
            error: r.error || untitled,
          }),
        );
        return;
      }
      const gone = new Set([...(r.deleted ?? []), ...(r.missing ?? [])]);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const id of gone) next.delete(remoteTitleKey(confirm.alias, id));
        return next;
      });
      await watch.refreshSessions(confirm.alias);
      onImportedSessionsChanged?.();
      if (selectedLive.size <= gone.size) exitSelect();
    } catch (e) {
      setOpenError(t("sidebar.remoteOpenFailed", { error: String(e) }));
    } finally {
      setDeleting(false);
      setConfirm(null);
    }
  };

  const openRow = async (
    alias: string,
    cwd: string,
    id: string,
    label: string,
  ) => {
    if (opening) return;
    setSelectedKey(remoteTitleKey(alias, id));
    setOpenError(null);
    watch.setDraftRemote({ alias, path: cwd || alias });
    setOpening(true);
    try {
      const r = await api.sshOpenSession(alias, id, {
        cwd: cwd || null,
        titleHint: label,
      });
      if (!r.ok || !r.appSessionId) {
        setOpenError(
          t("sidebar.remoteOpenFailed", {
            error: r.error || untitled,
          }),
        );
        return;
      }
      onOpenSession(r.appSessionId);
    } catch (e) {
      setOpenError(t("sidebar.remoteOpenFailed", { error: String(e) }));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="ssh-remote-rail">
      {watch.watchAliases.map((alias) => {
        const sessions = watch.sessionsByAlias[alias] ?? [];
        const total = watch.totalsByAlias[alias] ?? sessions.length;
        const remaining = remainingRemoteCount(total, sessions.length);
        const groups = groupRemoteSessionsByCwd(sessions);
        const hostExpanded = hostOpen[alias] !== false;
        return (
          <div key={alias} className="tree-project">
            <div
              className="tree-l2"
              role="button"
              tabIndex={0}
              aria-expanded={hostExpanded}
              onClick={() =>
                setHostOpen((prev) => ({
                  ...prev,
                  [alias]: !(prev[alias] !== false),
                }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setHostOpen((prev) => ({
                    ...prev,
                    [alias]: !(prev[alias] !== false),
                  }));
                }
              }}
            >
              <span className="tree-l2__icon" aria-hidden>
                <IconFolder size={15} />
              </span>
              <span className="tree-l2__name">
                {t("sidebar.remoteHost", { alias })}
              </span>
            </div>
            <SidebarTreeReveal open={hostExpanded}>
              <div className="tree-l3-list-wrap">
                {sessions.length === 0 ? (
                  <div className="sidebar-empty" style={{ padding: "4px 10px" }}>
                    {t("sidebar.remoteSessionsHint")}
                  </div>
                ) : (
                  groups.map((group) => {
                    const foldKey = pathFoldKey(alias, group.cwd);
                    const pathExpanded = pathOpen[foldKey] !== false;
                    const pathAria = group.cwd || group.label || untitled;
                    const groupKeys = group.sessions.map((s) =>
                      remoteTitleKey(alias, s.id),
                    );
                    const groupAllSelected = areAllIdsSelected(
                      selectedLive,
                      groupKeys,
                    );
                    return (
                      <div
                        key={foldKey}
                        className="tree-project tree-project--remote-path"
                      >
                        <div
                          className="tree-l2 tree-l2--nested"
                          role="button"
                          tabIndex={0}
                          title={remotePathTip(alias, group.cwd)}
                          aria-expanded={pathExpanded}
                          aria-label={pathAria}
                          onClick={() =>
                            setPathOpen((prev) => ({
                              ...prev,
                              [foldKey]: !(prev[foldKey] !== false),
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setPathOpen((prev) => ({
                                ...prev,
                                [foldKey]: !(prev[foldKey] !== false),
                              }));
                            }
                          }}
                        >
                          <span className="tree-l2__icon" aria-hidden>
                            <IconFolder size={15} />
                          </span>
                          <span className="tree-l2__name">{group.label}</span>
                          <span
                            className="tree-l2__actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {selectMode && groupKeys.length > 0 ? (
                              <button
                                type="button"
                                className={
                                  "tree-l2__select-all" +
                                  (groupAllSelected
                                    ? " tree-l2__select-all--on"
                                    : "")
                                }
                                aria-label={
                                  groupAllSelected
                                    ? t("sidebar.deselectAllInGroup")
                                    : t("sidebar.selectAllInGroup")
                                }
                                aria-pressed={groupAllSelected}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedKeys((prev) =>
                                    toggleIdsInSet(prev, groupKeys),
                                  );
                                }}
                              >
                                <span
                                  className={
                                    "tree-l3__check" +
                                    (groupAllSelected ? " is-on" : "")
                                  }
                                  aria-hidden
                                >
                                  {groupAllSelected ? (
                                    <IconCheck size={11} stroke={2.4} />
                                  ) : null}
                                </span>
                              </button>
                            ) : (
                              <Tip label={t("sidebar.newConversation")}>
                                <button
                                  type="button"
                                  className="tree-icon-btn"
                                  disabled={!group.cwd.trim()}
                                  aria-label={t("sidebar.newConversation")}
                                  data-testid="ssh-remote-new-conversation"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!group.cwd.trim()) return;
                                    watch.setDraftRemote({
                                      alias,
                                      path: group.cwd,
                                    });
                                    onNewConversation?.(alias, group.cwd);
                                  }}
                                >
                                  <IconSquarePen size={14} />
                                </button>
                              </Tip>
                            )}
                          </span>
                        </div>
                        <SidebarTreeReveal open={pathExpanded}>
                          <div className="tree-l3-list">
                            {group.sessions.map((s) => {
                              const key = remoteTitleKey(alias, s.id);
                              const label = remoteSessionLabel({
                                title: s.title,
                                cwd: s.cwd,
                                custom: watch.titleOverlay[key],
                                untitled,
                              });
                              const editing = editingKey === key;
                              const active = selectedKey === key;
                              const busy = opening && active;
                              const checked = selectedLive.has(key);
                              return (
                                <div
                                  key={key}
                                  className={
                                    "tree-l3 tree-l3--nested" +
                                    (active ? " tree-l3--active" : "") +
                                    (busy ? " tree-l3--working" : "") +
                                    (editing ? " tree-l3--renaming" : "") +
                                    (selectMode ? " tree-l3--select-mode" : "") +
                                    (checked ? " tree-l3--checked" : "")
                                  }
                                  role="button"
                                  tabIndex={0}
                                  title={remotePathTip(alias, s.cwd)}
                                  aria-busy={busy || undefined}
                                  aria-checked={selectMode ? checked : undefined}
                                  aria-label={label}
                                  data-remote-session-key={key}
                                  onMouseDown={(e: MouseEvent<HTMLDivElement>) => {
                                    if (editing) return;
                                    if (e.button !== 0) return;
                                    if (!isSelectModifierEvent(e)) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    modSelectLockRef.current = true;
                                    toggleSelect(key, { shiftKey: e.shiftKey });
                                  }}
                                  onClick={(e: MouseEvent<HTMLDivElement>) => {
                                    if (e.detail > 1) return;
                                    if (editing) return;
                                    if (modSelectLockRef.current) {
                                      modSelectLockRef.current = false;
                                      e.preventDefault();
                                      e.stopPropagation();
                                      return;
                                    }
                                    if (selectMode || isSelectModifierEvent(e)) {
                                      e.preventDefault();
                                      toggleSelect(key, { shiftKey: e.shiftKey });
                                      return;
                                    }
                                    void openRow(alias, s.cwd, s.id, label);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (selectMode && !checked) {
                                      toggleSelect(key);
                                    }
                                    setMenu({
                                      x: e.clientX,
                                      y: e.clientY,
                                      alias,
                                      id: s.id,
                                      key,
                                      label,
                                    });
                                  }}
                                  onDoubleClick={(e) => {
                                    if (selectMode) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setEditingKey(key);
                                    setDraft(label);
                                    window.setTimeout(
                                      () => inputRef.current?.select(),
                                      0,
                                    );
                                  }}
                                  onKeyDown={(
                                    e: KeyboardEvent<HTMLDivElement>,
                                  ) => {
                                    if (editing) return;
                                    if (e.key === "F2" && !selectMode) {
                                      e.preventDefault();
                                      setEditingKey(key);
                                      setDraft(label);
                                      return;
                                    }
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      if (selectMode) {
                                        toggleSelect(key, {
                                          shiftKey: e.shiftKey,
                                        });
                                        return;
                                      }
                                      void openRow(alias, s.cwd, s.id, label);
                                    }
                                  }}
                                >
                                  {selectMode ? (
                                    <span
                                      className={
                                        "tree-l3__check" +
                                        (checked ? " is-on" : "")
                                      }
                                      aria-hidden
                                    >
                                      {checked ? (
                                        <IconCheck size={11} stroke={2.4} />
                                      ) : null}
                                    </span>
                                  ) : null}
                                  <span className="tree-l3__title">
                                    {editing ? (
                                      <input
                                        ref={inputRef}
                                        className="tree-l3__rename"
                                        value={draft}
                                        aria-label={t("session.renamePrompt")}
                                        spellCheck={false}
                                        autoComplete="off"
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) =>
                                          setDraft(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                          e.stopPropagation();
                                          if (e.nativeEvent.isComposing) return;
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            commitRename(alias, s.id, label);
                                          } else if (e.key === "Escape") {
                                            e.preventDefault();
                                            setEditingKey(null);
                                          }
                                        }}
                                        onBlur={() =>
                                          commitRename(alias, s.id, label)
                                        }
                                      />
                                    ) : (
                                      <SidebarSessionName title={label} />
                                    )}
                                  </span>
                                  {busy ? (
                                    <span
                                      className="tree-l3__status"
                                      aria-label={t("sidebar.remoteOpening")}
                                    >
                                      <Spinner
                                        size={14}
                                        className="tree-l3__spinner"
                                      />
                                    </span>
                                  ) : (
                                    <SidebarSessionRelativeTime
                                      updatedAt={s.updatedAt ?? undefined}
                                      locale={locale}
                                      enabled={showRelativeTime}
                                    />
                                  )}
                                  {selectMode ? null : (
                                    <Tip label={t("sidebar.menu")}>
                                      <button
                                        type="button"
                                        className="tree-icon-btn"
                                        aria-label={t("sidebar.menu")}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            alias,
                                            id: s.id,
                                            key,
                                            label,
                                          });
                                        }}
                                      >
                                        <IconMore size={13} />
                                      </button>
                                    </Tip>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </SidebarTreeReveal>
                      </div>
                    );
                  })
                )}
                {openError && selectedKey?.startsWith(`${alias}:`) ? (
                  <div className="tree-l3 tree-l3--hint" role="alert">
                    {openError}
                  </div>
                ) : null}
                {remaining > 0 ? (
                  <button
                    type="button"
                    className="tree-l3"
                    onClick={() => void watch.loadMore(alias)}
                  >
                    {t("sidebar.remoteLoadMore")}
                    <span className="tree-l3__time">
                      {t("sidebar.remoteRemaining", { n: remaining })}
                    </span>
                  </button>
                ) : null}
              </div>
            </SidebarTreeReveal>
          </div>
        );
      })}
      {selectMode ? (
        <div className="sidebar-select-bar" role="toolbar">
          <span className="sidebar-select-bar__count">
            {t("sidebar.selectedCount", { n: selectedLive.size })}
          </span>
          <div className="sidebar-select-bar__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={exitSelect}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--danger"
              disabled={selectedLive.size === 0 || deleting}
              onClick={() => {
                const byAlias = new Map<
                  string,
                  Array<{ id: string; label: string }>
                >();
                for (const key of selectedLive) {
                  const parsed = parseRemoteKey(key);
                  if (!parsed) continue;
                  const sessions =
                    watch.sessionsByAlias[parsed.alias] ?? [];
                  const row = sessions.find((s) => s.id === parsed.id);
                  const label = remoteSessionLabel({
                    title: row?.title ?? "",
                    cwd: row?.cwd ?? "",
                    custom: watch.titleOverlay[key],
                    untitled,
                  });
                  const list = byAlias.get(parsed.alias) ?? [];
                  list.push({ id: parsed.id, label });
                  byAlias.set(parsed.alias, list);
                }
                const first = [...byAlias.entries()][0];
                if (first) askDelete(first[0], first[1]);
              }}
            >
              {t("sidebar.deleteSelected", { n: selectedLive.size })}
            </button>
          </div>
        </div>
      ) : null}
      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={
          ((): ContextMenuItem[] => {
            if (!menu) return [];
            const items: ContextMenuItem[] = [];
            if (!selectMode) {
              items.push({
                id: "select",
                label: t("sidebar.select"),
                icon: <IconListCheck size={16} />,
                onClick: () => toggleSelect(menu.key),
              });
              items.push({
                id: "rename",
                label: t("session.renamePrompt"),
                icon: <IconRename size={16} />,
                onClick: () => {
                  setEditingKey(menu.key);
                  setDraft(menu.label);
                },
              });
            }
            items.push({
              id: "delete",
              label: t("session.delete"),
              icon: <IconTrash size={16} />,
              danger: true,
              onClick: () => {
                const targets =
                  selectMode && selectedLive.size > 0
                    ? [...selectedLive]
                        .map(parseRemoteKey)
                        .filter(
                          (p): p is { alias: string; id: string } =>
                            !!p && p.alias === menu.alias,
                        )
                        .map((p) => {
                          const row = (
                            watch.sessionsByAlias[p.alias] ?? []
                          ).find((s) => s.id === p.id);
                          return {
                            id: p.id,
                            label: remoteSessionLabel({
                              title: row?.title ?? "",
                              cwd: row?.cwd ?? "",
                              custom: watch.titleOverlay[
                                remoteTitleKey(p.alias, p.id)
                              ],
                              untitled,
                            }),
                          };
                        })
                    : [{ id: menu.id, label: menu.label }];
                askDelete(menu.alias, targets);
              },
            });
            return items;
          })()
        }
      />
      <GlassModal
        open={!!confirm}
        onClose={() => {
          if (!deleting) setConfirm(null);
        }}
        title={
          confirm && confirm.items.length > 1
            ? t("session.deleteManyTitle")
            : t("session.deleteTitle")
        }
        size="sm"
        closeLabel={t("common.cancel")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={deleting}
              onClick={() => setConfirm(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={deleting}
              onClick={() => void runDelete()}
            >
              {t("session.delete")}
            </button>
          </>
        }
      >
        {confirm
          ? confirm.items.length === 1
            ? t("sidebar.remoteDeleteConfirm", {
                name: confirm.items[0].label,
                alias: confirm.alias,
              })
            : t("sidebar.remoteDeleteManyConfirm", {
                n: confirm.items.length,
                alias: confirm.alias,
              })
          : null}
      </GlassModal>
    </div>
  );
}
