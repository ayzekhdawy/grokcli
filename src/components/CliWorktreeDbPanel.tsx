/**
 * Settings → Runtime → CLI: Grok Build worktree DB maintenance
 * (`grok worktree db path|stats|rebuild`, 0.2.117+). Soft-fails on older CLIs.
 */

import { useCallback, useEffect, useState } from "react";
import type { MessageKey, Vars } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import * as api from "@/lib/api";
import type {
  CliWorktreeDbPathResult,
  CliWorktreeDbRebuildResult,
  CliWorktreeDbStatsResult,
} from "@/lib/api";
import {
  cliWorktreeDbStatsHasData,
  formatCliWorktreeDbStatsSummary,
} from "@/lib/cliWorktrees";

export function CliWorktreeDbPanel({
  t,
}: {
  t: (k: MessageKey, vars?: Vars) => string;
}) {
  const [pathRes, setPathRes] = useState<CliWorktreeDbPathResult | null>(null);
  const [statsRes, setStatsRes] = useState<CliWorktreeDbStatsResult | null>(
    null,
  );
  const [busy, setBusy] = useState<"refresh" | "rebuild" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [lastRebuild, setLastRebuild] =
    useState<CliWorktreeDbRebuildResult | null>(null);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) return;
    setBusy("refresh");
    setError(null);
    try {
      const [path, stats] = await Promise.all([
        api.cliWorktreeDbPath(),
        api.cliWorktreeDbStats(),
      ]);
      setPathRes(path);
      setStatsRes(stats);
      const reason =
        (!path.available && path.reason) ||
        (!stats.available && stats.reason) ||
        null;
      if (reason && (path.unsupported || stats.unsupported)) {
        setNote(null);
      } else if (reason && !path.available && !stats.available) {
        setError(reason);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCopyPath = async () => {
    const p = pathRes?.path?.trim();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRevealPath = async () => {
    const p = pathRes?.path?.trim();
    if (!p) return;
    try {
      await api.pathReveal(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRebuild = async () => {
    if (!api.isTauri()) return;
    setBusy("rebuild");
    setError(null);
    setNote(null);
    setConfirmRebuild(false);
    try {
      const res = await api.cliWorktreeDbRebuild();
      setLastRebuild(res);
      if (res.unsupported) {
        setError(
          res.reason?.trim() || t("settings.cliWorktreeDb.unsupportedBody"),
        );
        return;
      }
      if (!res.ok) {
        setError(
          res.reason?.trim() ||
            res.message?.trim() ||
            t("settings.cliWorktreeDb.rebuildFailed"),
        );
        return;
      }
      const parts: string[] = [];
      if (res.discovered != null) {
        parts.push(
          t("settings.cliWorktreeDb.rebuildDiscovered", {
            n: String(res.discovered),
          }),
        );
      }
      if (res.registered != null) {
        parts.push(
          t("settings.cliWorktreeDb.rebuildRegistered", {
            n: String(res.registered),
          }),
        );
      }
      if (res.alreadyTracked != null) {
        parts.push(
          t("settings.cliWorktreeDb.rebuildAlready", {
            n: String(res.alreadyTracked),
          }),
        );
      }
      setNote(
        parts.length
          ? t("settings.cliWorktreeDb.rebuildDoneDetail", {
              detail: parts.join(" · "),
            })
          : t("settings.cliWorktreeDb.rebuildDone"),
      );
      // Refresh path + stats after a successful rebuild.
      const [path, stats] = await Promise.all([
        api.cliWorktreeDbPath(),
        api.cliWorktreeDbStats(),
      ]);
      setPathRes(path);
      setStatsRes(stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!api.isTauri()) {
    return (
      <div
        className="settings-card"
        id="settings-anchor-cliWorktreeDb"
      >
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.cliWorktreeDb.title")}
            </div>
            <div className="settings-row__desc">
              {t("settings.cliWorktreeDb.desktopOnly")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const unsupported =
    pathRes?.unsupported === true || statsRes?.unsupported === true;
  const cliMissing =
    pathRes?.cliFound === false || statsRes?.cliFound === false;
  const path = pathRes?.path?.trim() || "";
  const pathOk = !!pathRes?.pathOk;
  const summary =
    statsRes?.summary?.trim() ||
    formatCliWorktreeDbStatsSummary(statsRes?.stats ?? null) ||
    null;
  const hasStats = cliWorktreeDbStatsHasData(statsRes?.stats ?? null);
  const loading = busy === "refresh" && !pathRes && !statsRes;
  const canRebuild =
    !busy && !unsupported && !cliMissing && pathRes?.available !== false;

  const badgeLabel = unsupported
    ? t("settings.cliWorktreeDb.stateUnsupported")
    : cliMissing
      ? t("settings.cliWorktreeDb.stateNoCli")
      : pathRes?.available || statsRes?.available
        ? t("settings.cliWorktreeDb.stateOk")
        : loading
          ? t("settings.cliWorktreeDb.loading")
          : t("settings.cliWorktreeDb.stateUnavailable");
  const badgeTone = unsupported || cliMissing
    ? "err"
    : pathRes?.available || statsRes?.available
      ? "ok"
      : "muted";

  return (
    <>
      <div
        className="settings-card"
        id="settings-anchor-cliWorktreeDb"
      >
        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.cliWorktreeDb.title")}
            </div>
            <div className="settings-row__desc">
              {t("settings.cliWorktreeDb.desc")}
            </div>
          </div>
          <div className="rim-btn-row" style={{ alignItems: "center", gap: 8 }}>
            <span
              className={
                "account-badge" +
                (badgeTone === "ok"
                  ? " account-badge--ok"
                  : badgeTone === "err"
                    ? " account-badge--warn"
                    : " account-badge--muted")
              }
            >
              {badgeLabel}
            </span>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!busy}
              onClick={() => void refresh()}
            >
              {busy === "refresh"
                ? t("settings.cliWorktreeDb.refreshing")
                : t("settings.cliWorktreeDb.refresh")}
            </button>
          </div>
        </div>

        {unsupported ? (
          <div className="settings-row settings-row--stack">
            <div className="settings-row__hint" role="status">
              {t("settings.cliWorktreeDb.unsupportedBody")}
            </div>
          </div>
        ) : (
          <>
            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.cliWorktreeDb.path")}
                </div>
                <div className="settings-row__desc">
                  {path ||
                    (loading
                      ? t("settings.cliWorktreeDb.loading")
                      : t("settings.cliWorktreeDb.pathUnknown"))}
                </div>
                {path ? (
                  <div className="settings-row__hint">
                    {pathOk
                      ? t("settings.cliWorktreeDb.pathExists")
                      : t("settings.cliWorktreeDb.pathMissing")}
                  </div>
                ) : null}
              </div>
              <div className="rim-btn-row">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!path}
                  onClick={() => void onCopyPath()}
                >
                  {copied
                    ? t("settings.cliWorktreeDb.copied")
                    : t("settings.cliWorktreeDb.copyPath")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!path || !pathOk}
                  onClick={() => void onRevealPath()}
                >
                  {t("settings.cliWorktreeDb.revealPath")}
                </button>
              </div>
            </div>

            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.cliWorktreeDb.stats")}
                </div>
                <div className="settings-row__desc">
                  {summary ||
                    (loading
                      ? t("settings.cliWorktreeDb.loading")
                      : t("settings.cliWorktreeDb.statsEmpty"))}
                </div>
                {hasStats && statsRes?.stats ? (
                  <div className="settings-row__hint">
                    {[
                      statsRes.stats.total != null
                        ? t("settings.cliWorktreeDb.statTotal", {
                            n: String(statsRes.stats.total),
                          })
                        : null,
                      statsRes.stats.alive != null
                        ? t("settings.cliWorktreeDb.statAlive", {
                            n: String(statsRes.stats.alive),
                          })
                        : null,
                      statsRes.stats.dead != null
                        ? t("settings.cliWorktreeDb.statDead", {
                            n: String(statsRes.stats.dead),
                          })
                        : null,
                      statsRes.stats.dbSize
                        ? t("settings.cliWorktreeDb.statSize", {
                            size: statsRes.stats.dbSize,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.cliWorktreeDb.rebuild")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.cliWorktreeDb.rebuildDesc")}
                </div>
              </div>
              <div className="rim-btn-row">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!canRebuild}
                  onClick={() => setConfirmRebuild(true)}
                >
                  {busy === "rebuild"
                    ? t("settings.cliWorktreeDb.rebuilding")
                    : t("settings.cliWorktreeDb.rebuild")}
                </button>
              </div>
              {lastRebuild?.ok && lastRebuild.message ? (
                <div className="settings-row__hint" role="status">
                  {lastRebuild.message}
                </div>
              ) : null}
            </div>
          </>
        )}

        {(error || note) && (
          <div className="settings-row settings-row--stack">
            {error ? (
              <div className="settings-row__hint is-danger" role="alert">
                {error}
              </div>
            ) : null}
            {note ? (
              <div className="settings-row__hint" role="status">
                {note}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <GlassModal
        open={confirmRebuild}
        onClose={() => {
          if (busy === "rebuild") return;
          setConfirmRebuild(false);
        }}
        title={t("settings.cliWorktreeDb.rebuildConfirmTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy === "rebuild"}
              onClick={() => setConfirmRebuild(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy === "rebuild"}
              onClick={() => void onRebuild()}
            >
              {busy === "rebuild"
                ? t("settings.cliWorktreeDb.rebuilding")
                : t("settings.cliWorktreeDb.rebuildConfirmAction")}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {t("settings.cliWorktreeDb.rebuildConfirmBody")}
        </p>
        {path ? (
          <p
            className="settings-row__hint"
            style={{ marginTop: 10, wordBreak: "break-all" }}
          >
            {path}
          </p>
        ) : null}
      </GlassModal>
    </>
  );
}
