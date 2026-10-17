/**
 * Session text export: markdown modal, JSON/plain/HTML/NDJSON, diagnostic zip, traces.
 * Host supplies toast, confirm dialog, and live session/messages.
 */
import { useCallback, useMemo, useState } from "react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import type { ChatMessage } from "@/lib/session";
import {
  sessionExportMimeType,
  sessionToHtml,
  sessionToJson,
  sessionToMarkdown,
  sessionToPlain,
} from "@/lib/sessionExport";
import {
  buildStreamSessionNdjson,
  streamSessionExportFilename,
  streamSessionExportMimeType,
  type StreamSessionExportFormat,
} from "@/lib/streamSessionExport";
import {
  canSessionExportActions,
  classifySessionExportCliError,
  estimateSessionExportSizeClass,
  formatSessionExportBytes,
  isSessionExportJournalEmpty,
  resolveSessionExportPath,
  resolveSessionExportSoftFail,
  sessionExportCliSoftFailsToJournal,
  sessionExportDoneMessageKey,
  sessionExportSafeFilename,
  sessionExportSizeClassLabelKey,
} from "@/lib/sessionExportPro";
import { recordTraceExport } from "@/lib/traceHistory";

type TFn = ReturnType<typeof createT>;

export function useSessionExportText(opts: {
  session: {
    sessionId: string | null;
    title?: string;
    agentSessionId?: string | null;
  };
  sessions: SessionRow[];
  messages: ChatMessage[];
  projects: Project[];
  activeProject: Project | null;
  tr: TFn;
  showToast: (msg: string, ms?: number) => void;
  setAppDialog: (dialog: NonNullable<AppDialog>) => void;
}) {
  const {
    session,
    sessions,
    messages,
    projects,
    activeProject,
    tr,
    showToast,
    setAppDialog,
  } = opts;

  type ExportMdTarget = {
    id: string;
    title: string;
    projectId?: string | null;
  };
  const [exportMdTarget, setExportMdTarget] = useState<ExportMdTarget | null>(
    null,
  );
  const [exportMdIncludeThoughts, setExportMdIncludeThoughts] = useState(true);
  const [exportMdIncludeTools, setExportMdIncludeTools] = useState(true);
  const [exportMdBusy, setExportMdBusy] = useState(false);
  /** Build markdown for a session; used by download + copy. */
  const buildSessionMarkdown = useCallback(
    async (
      sessionMeta: ExportMdTarget | undefined,
      options: { includeThoughts: boolean; includeToolSummary: boolean },
    ) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        const err = new Error("no target");
        (err as Error & { code?: string }).code = "no_target";
        throw err;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      const projectId =
        sessionMeta?.projectId ??
        sessions.find((s) => s.id === id)?.projectId ??
        null;
      const proj =
        projects.find((p) => p.id === projectId) || activeProject || null;
      let msgs = messages;
      if (id !== session.sessionId) {
        try {
          msgs = (await api.sessionMessages(id)) as ChatMessage[];
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          (err as Error & { code?: string }).code = "load_failed";
          throw err;
        }
      }
      const exportable = msgs.map((m) => ({
        role: m.role,
        content: m.content,
        thought: m.thought,
        createdAt: m.createdAt,
        marker: m.marker,
      }));
      const journalEmpty = isSessionExportJournalEmpty(exportable, {
        format: "markdown",
        options,
      });
      const md = sessionToMarkdown({
        title,
        projectName: proj?.name,
        projectPath: proj?.path,
        sessionId: id,
        options: {
          includeThoughts: options.includeThoughts,
          includeToolSummary: options.includeToolSummary,
        },
        messages: exportable,
      });
      return { id, title, md, journalEmpty, exportable };
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      tr,
    ],
  );

  /** Toast classified soft-fail for text-format export (silent on cancel). */
  const toastSessionExportSoftFail = useCallback(
    (err: unknown) => {
      const r = resolveSessionExportSoftFail(err);
      if (r.silent) return;
      const base = tr(r.messageKey as Parameters<typeof tr>[0]);
      showToast(r.detail ? `${base}: ${r.detail}` : base);
    },
    [showToast, tr],
  );

  /** Open export options (thoughts / tools / download / copy). */
  const openExportSessionMd = useCallback(
    (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      setExportMdIncludeThoughts(true);
      setExportMdIncludeTools(true);
      setExportMdTarget({
        id,
        title:
          sessionMeta?.title ||
          sessions.find((s) => s.id === id)?.title ||
          session.title ||
          tr("session.untitled"),
        projectId:
          sessionMeta?.projectId ??
          sessions.find((s) => s.id === id)?.projectId ??
          null,
      });
    },
    [session.sessionId, session.title, sessions, showToast, tr],
  );

  /**
   * Honest empty + size estimate + path badges for the open Markdown export
   * dialog (options toggle updates emptiness and Journal vs CLI path).
   */
  const exportMdHonesty = useMemo(() => {
    const options = {
      includeThoughts: exportMdIncludeThoughts,
      includeToolSummary: exportMdIncludeTools,
    };
    const resolveAgent = (sessionId: string | null | undefined) => {
      const id = (sessionId || "").trim();
      if (!id) return null as string | null;
      if (id === session.sessionId) {
        const live = (session.agentSessionId || "").trim();
        if (live) return live;
      }
      const row = sessions.find((x) => x.id === id);
      const linked = (row?.agentSessionId || "").trim();
      return linked || null;
    };
    const pathFor = (sessionId: string | null | undefined) =>
      resolveSessionExportPath({
        format: "markdown",
        mode: "download",
        hasAgentSession: resolveAgent(sessionId),
        cliHostAvailable: api.isTauri(),
        options,
      });

    if (!exportMdTarget) {
      return {
        journalEmpty: null as boolean | null,
        sizeClassKey: null as string | null,
        sizeBytesLabel: null as string | null,
        canAct: false,
        path: null as ReturnType<typeof resolveSessionExportPath> | null,
      };
    }
    if (exportMdTarget.id !== session.sessionId) {
      const path = pathFor(exportMdTarget.id);
      return {
        journalEmpty: null as boolean | null,
        sizeClassKey: null as string | null,
        sizeBytesLabel: null as string | null,
        canAct: canSessionExportActions({
          hasTarget: true,
          journalEmpty: null,
          busy: exportMdBusy,
        }),
        path,
      };
    }
    const exportable = messages.map((m) => ({
      role: m.role,
      content: m.content,
      thought: m.thought,
      createdAt: m.createdAt,
      marker: m.marker,
    }));
    const journalEmpty = isSessionExportJournalEmpty(exportable, {
      format: "markdown",
      options,
    });
    const md = sessionToMarkdown({
      title: exportMdTarget.title || tr("session.untitled"),
      sessionId: exportMdTarget.id,
      options,
      messages: exportable,
    });
    const est = estimateSessionExportSizeClass(journalEmpty ? "" : md);
    const path = pathFor(exportMdTarget.id);
    return {
      journalEmpty,
      sizeClassKey: sessionExportSizeClassLabelKey(est.sizeClass),
      sizeBytesLabel: formatSessionExportBytes(est.byteLength),
      canAct: canSessionExportActions({
        hasTarget: true,
        journalEmpty,
        busy: exportMdBusy,
      }),
      path,
    };
  }, [
    exportMdTarget,
    exportMdIncludeThoughts,
    exportMdIncludeTools,
    exportMdBusy,
    session.sessionId,
    session.agentSessionId,
    sessions,
    messages,
    tr,
  ]);

  const runExportSessionMd = useCallback(
    async (mode: "download" | "copy") => {
      if (!exportMdTarget) return;
      setExportMdBusy(true);
      try {
        const exportOpts = {
          includeThoughts: exportMdIncludeThoughts,
          includeToolSummary: exportMdIncludeTools,
        };
        const agentLinked = (() => {
          const id = exportMdTarget.id;
          if (id === session.sessionId) {
            const live = (session.agentSessionId || "").trim();
            if (live) return live;
          }
          const row = sessions.find((x) => x.id === id);
          return (row?.agentSessionId || "").trim() || null;
        })();
        const path = resolveSessionExportPath({
          format: "markdown",
          mode,
          hasAgentSession: agentLinked,
          cliHostAvailable: api.isTauri(),
          options: exportOpts,
        });
        // Prefer CLI `grok export` for full-transcript download when path says so;
        // soft-fail to local journal (thoughts/tools options always apply locally).
        if (mode === "download" && path.preferCli) {
          try {
            const cli = await api.sessionCliExport(exportMdTarget.id);
            const md = typeof cli?.markdown === "string" ? cli.markdown : "";
            if (cli?.ok && md.trim()) {
              const blob = new Blob([md], {
                type: sessionExportMimeType("markdown"),
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = sessionExportSafeFilename(
                "markdown",
                exportMdTarget.title,
                exportMdTarget.id,
              );
              a.click();
              URL.revokeObjectURL(url);
              showToast(
                tr(
                  sessionExportDoneMessageKey(
                    "cli",
                  ) as Parameters<typeof tr>[0],
                ),
              );
              setExportMdTarget(null);
              return;
            }
          } catch (e) {
            // Soft-fail policy: classify then always fall through to journal.
            const kind = classifySessionExportCliError(e);
            if (!sessionExportCliSoftFailsToJournal(kind)) {
              toastSessionExportSoftFail(e);
              return;
            }
          }
        }
        const { id, title, md, journalEmpty } = await buildSessionMarkdown(
          exportMdTarget,
          exportOpts,
        );
        if (journalEmpty) {
          showToast(tr("session.exportEmpty"));
          return;
        }
        if (mode === "copy") {
          try {
            await navigator.clipboard.writeText(md);
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "clipboard";
            toastSessionExportSoftFail(err);
            return;
          }
          showToast(tr("session.exportCopied"));
        } else {
          try {
            const blob = new Blob([md], {
              type: sessionExportMimeType("markdown"),
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = sessionExportSafeFilename("markdown", title, id);
            a.click();
            URL.revokeObjectURL(url);
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "write_failed";
            toastSessionExportSoftFail(err);
            return;
          }
          showToast(
            tr(
              sessionExportDoneMessageKey(
                "journal",
              ) as Parameters<typeof tr>[0],
            ),
          );
        }
        setExportMdTarget(null);
      } catch (e) {
        toastSessionExportSoftFail(e);
      } finally {
        setExportMdBusy(false);
      }
    },
    [
      exportMdTarget,
      exportMdIncludeThoughts,
      exportMdIncludeTools,
      buildSessionMarkdown,
      session.sessionId,
      session.agentSessionId,
      sessions,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  /**
   * One-click copy of the full conversation as Markdown.
   * Skips pure tool_step noise by default (unlike the export dialog).
   */
  const copyConversationMarkdown = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      try {
        const { md, journalEmpty } = await buildSessionMarkdown(
          {
            id,
            title:
              sessionMeta?.title ||
              sessions.find((s) => s.id === id)?.title ||
              session.title ||
              tr("session.untitled"),
            projectId:
              sessionMeta?.projectId ??
              sessions.find((s) => s.id === id)?.projectId ??
              null,
          },
          {
            includeThoughts: true,
            includeToolSummary: false,
          },
        );
        if (journalEmpty || !md.trim()) {
          showToast(tr("session.copyMdEmpty"));
          return;
        }
        await navigator.clipboard.writeText(md);
      } catch (e) {
        toastSessionExportSoftFail(e);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      buildSessionMarkdown,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  /** Quick export with defaults (slash /export, message actions). */
  const exportActiveSessionMd = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      openExportSessionMd(sessionMeta);
    },
    [openExportSessionMd],
  );

  /**
   * Download session as import-friendly JSON (user/assistant only; no modal).
   * Reuses the same message loading path as Markdown export.
   */
  const exportSessionJson = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      try {
        let msgs = messages;
        if (id !== session.sessionId) {
          try {
            msgs = (await api.sessionMessages(id)) as ChatMessage[];
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "load_failed";
            toastSessionExportSoftFail(err);
            return;
          }
        }
        const exportable = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        }));
        if (
          isSessionExportJournalEmpty(exportable, {
            format: "json",
            options: { includeThoughts: false, includeToolSummary: false },
          })
        ) {
          showToast(tr("session.exportEmpty"));
          return;
        }
        const json = sessionToJson({
          title,
          sessionId: id,
          // Clean re-import: omit thoughts/tools by default.
          options: { includeThoughts: false, includeToolSummary: false },
          messages: exportable,
        });
        const blob = new Blob([json], {
          type: sessionExportMimeType("json"),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportSafeFilename("json", title, id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toastSessionExportSoftFail(e);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );
  /**
   * Download session as plain text (headless `--output-format plain` style).
   * Local journal only; no modal. Thoughts + tool summaries on by default.
   */
  const exportSessionPlain = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      const projectId =
        sessionMeta?.projectId ??
        sessions.find((s) => s.id === id)?.projectId ??
        null;
      const proj =
        projects.find((p) => p.id === projectId) || activeProject || null;
      try {
        let msgs = messages;
        if (id !== session.sessionId) {
          try {
            msgs = (await api.sessionMessages(id)) as ChatMessage[];
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "load_failed";
            toastSessionExportSoftFail(err);
            return;
          }
        }
        const exportable = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        }));
        if (
          isSessionExportJournalEmpty(exportable, {
            format: "plain",
            options: { includeThoughts: true, includeToolSummary: true },
          })
        ) {
          showToast(tr("session.exportEmpty"));
          return;
        }
        const text = sessionToPlain({
          title,
          projectName: proj?.name,
          projectPath: proj?.path,
          sessionId: id,
          options: { includeThoughts: true, includeToolSummary: true },
          messages: exportable,
        });
        const blob = new Blob([text], {
          type: sessionExportMimeType("plain"),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportSafeFilename("plain", title, id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toastSessionExportSoftFail(e);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  /**
   * Download session as a standalone HTML page (blob save).
   * Defaults match Markdown file export: thoughts + tool summaries on.
   */
  const exportSessionHtml = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      const projectId =
        sessionMeta?.projectId ??
        sessions.find((s) => s.id === id)?.projectId ??
        null;
      const proj =
        projects.find((p) => p.id === projectId) || activeProject || null;
      try {
        let msgs = messages;
        if (id !== session.sessionId) {
          try {
            msgs = (await api.sessionMessages(id)) as ChatMessage[];
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "load_failed";
            toastSessionExportSoftFail(err);
            return;
          }
        }
        const exportable = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        }));
        if (
          isSessionExportJournalEmpty(exportable, {
            format: "html",
            options: { includeThoughts: true, includeToolSummary: true },
          })
        ) {
          showToast(tr("session.exportEmpty"));
          return;
        }
        const html = sessionToHtml({
          title,
          projectName: proj?.name,
          projectPath: proj?.path,
          sessionId: id,
          options: { includeThoughts: true, includeToolSummary: true },
          messages: exportable,
        });
        const blob = new Blob([html], {
          type: sessionExportMimeType("html"),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportSafeFilename("html", title, id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toastSessionExportSoftFail(e);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  /**
   * Download session journal as redacted ACP streaming NDJSON
   * (`streaming-json` or `streaming-messages-json`). Soft-empty toast when
   * the journal has no exportable rows.
   */
  const exportSessionStreamNdjson = useCallback(
    async (
      format: StreamSessionExportFormat,
      sessionMeta?: {
        id: string;
        title: string;
        projectId?: string | null;
      },
    ) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportFail"));
        return;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      const projectId =
        sessionMeta?.projectId ??
        sessions.find((s) => s.id === id)?.projectId ??
        null;
      const proj =
        projects.find((p) => p.id === projectId) || activeProject || null;
      try {
        let msgs = messages;
        if (id !== session.sessionId) {
          msgs = (await api.sessionMessages(id)) as ChatMessage[];
        }
        const result = buildStreamSessionNdjson(format, {
          title,
          projectName: proj?.name,
          projectPath: proj?.path,
          sessionId: id,
          options: { includeThoughts: true, includeToolSummary: true },
          messages: msgs.map((m) => ({
            role: m.role,
            content: m.content,
            thought: m.thought,
            createdAt: m.createdAt,
            marker: m.marker,
          })),
        });
        if (result.empty || !result.body) {
          showToast(tr("session.exportStreamEmpty"));
          return;
        }
        const blob = new Blob([result.body], {
          type: streamSessionExportMimeType(format),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = streamSessionExportFilename(format, title, id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        showToast(`${tr("session.exportFail")}: ${String(e)}`);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      showToast,
      tr,
    ],
  );

  /** Full diagnostic zip (messages + agent trail + logs) for bug reports.
   * Always available — never gated on busy/connecting. Host packs on a
   * blocking pool; reveal is fire-and-forget so export cannot freeze quit.
   */
  const exportSessionDiagnostic = useCallback(
    async (sessionId?: string | null) => {
      const id = sessionId || session.sessionId;
      if (!id) {
        showToast(tr("session.exportBundleFail"));
        return;
      }
      // Immediate feedback so long zip/save never looks like a freeze.
      showToast(tr("session.exportBundle"), 2500);
      try {
        const res = await api.exportSessionBundle(id);
        if (res?.ok && res.path) {
          showToast(tr("session.exportBundleDone"), 4000);
        } else {
          showToast(tr("session.exportBundleFail"));
        }
      } catch (e) {
        showToast(`${tr("session.exportBundleFail")}: ${String(e)}`, 5000);
      }
    },
    [session.sessionId, showToast, tr],
  );

  /**
   * Export Grok Build CLI session trace.
   * `localOnly` default true → `grok trace --local`. False omits `--local` (may upload).
   */
  const exportSessionTrace = useCallback(
    async (
      sessionId?: string | null,
      opts?: { localOnly?: boolean },
    ) => {
      const id = sessionId || session.sessionId;
      const localOnly = opts?.localOnly !== false;
      if (!id) {
        showToast(tr("session.exportTraceFail"));
        return;
      }
      try {
        const res = await api.sessionTraceExport(id, { localOnly });
        if (res?.ok && res.path) {
          const row = sessions.find((s) => s.id === id);
          const uploaded = res.uploaded === true;
          recordTraceExport({
            sessionId: id,
            path: res.path,
            title: row?.title ?? null,
            sizeBytes:
              typeof res.sizeBytes === "number" ? res.sizeBytes : null,
            uploaded: uploaded || null,
          });
          if (!localOnly && !uploaded) {
            // Network allowed but CLI only wrote local (upload disabled / fallback).
            showToast(tr("session.exportTraceDoneLocalFallback"), 5000);
          }
        } else {
          showToast(tr("session.exportTraceFail"));
        }
      } catch (e) {
        const msg = String(e);
        if (/no agent session/i.test(msg)) {
          showToast(tr("session.exportTraceNoAgent"), 5000);
        } else if (/cli not found|grok build cli not found/i.test(msg)) {
          showToast(`${tr("session.exportTraceFail")}: ${tr("session.exportTraceNoCli")}`, 5500);
        } else if (/timed out/i.test(msg)) {
          showToast(
            `${tr("session.exportTraceFail")}: ${tr("session.exportTraceTimeout")}`,
            5500,
          );
        } else if (!localOnly && /upload|network|telemetry|403|401|forbidden/i.test(msg)) {
          showToast(
            `${tr("session.exportTraceUploadFail")}: ${msg}`,
            6000,
          );
        } else {
          // Actionable: surface host/CLI reason (already redacted server-side).
          showToast(`${tr("session.exportTraceFail")}: ${msg}`, 5500);
        }
      }
    },
    [session.sessionId, sessions, showToast, tr],
  );

  /** Confirm network upload before `grok trace` without `--local`. */
  const confirmExportSessionTraceUpload = useCallback(
    (sessionId?: string | null) => {
      const id = sessionId || session.sessionId;
      if (!id) {
        showToast(tr("session.exportTraceFail"));
        return;
      }
      setAppDialog({
        kind: "confirm",
        title: tr("session.exportTraceUploadTitle"),
        message: tr("session.exportTraceUploadMessage"),
        confirmLabel: tr("session.exportTraceUploadConfirm"),
        onConfirm: () => {
          void exportSessionTrace(id, { localOnly: false });
        },
      });
    },
    [exportSessionTrace, session.sessionId, showToast, tr],
  );

  const closeExportSessionMd = useCallback(() => setExportMdTarget(null), []);

  return {
    exportMdTarget,
    exportMdBusy,
    exportMdIncludeThoughts,
    setExportMdIncludeThoughts,
    exportMdIncludeTools,
    setExportMdIncludeTools,
    exportMdHonesty,
    closeExportSessionMd,
    runExportSessionMd,
    openExportSessionMd,
    exportActiveSessionMd,
    copyConversationMarkdown,
    exportSessionJson,
    exportSessionPlain,
    exportSessionHtml,
    exportSessionStreamNdjson,
    exportSessionDiagnostic,
    exportSessionTrace,
    confirmExportSessionTraceUpload,
  };
}
