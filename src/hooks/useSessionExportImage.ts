/**
 * Session share-card export: PNG preview, skin pref, copy/save.
 * Host supplies toast and live session/messages.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createT, type Locale } from "@/i18n";
import * as api from "@/lib/api";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import type { ChatMessage } from "@/lib/session";
import {
  blobToBase64 as pngBlobToBase64,
  buildExportImagePipeline,
  copyPngBlob,
  downloadPngBlob,
  exportableToShareMessages,
  sessionExportImageFilename,
  type ShareCardMessage,
} from "@/lib/sessionExportImage";
import {
  buildSessionFilePathMap,
  mergePathMaps,
} from "@/lib/sessionPathMap";
import {
  loadExportImageSkinPref,
  saveExportImageSkinPref,
  type ShareCardSkinId,
} from "@/lib/shareCardSkins";
import {
  buildExportImageMetaParts,
  canExportImageActions,
  deriveExportImagePreviewPhase,
  exportImageBlobMatchesOptions,
  formatExportImageBytes,
  resolveExportImageError,
  stampFromPipelineResult,
  type ExportImageBlobStamp,
} from "@/lib/exportSharePro";
import { loadExportLogoPref } from "@/lib/exportLogoPref";
import {
  applyResolvedSessionMedia,
  buildInlineMediaPathMap,
  collectSessionRelativeMediaRefs,
} from "@/lib/attachments";

type TFn = ReturnType<typeof createT>;

export function useSessionExportImage(opts: {
  session: {
    sessionId: string | null;
    title?: string;
    agentSessionId?: string | null;
  };
  sessions: SessionRow[];
  messages: ChatMessage[];
  projects: Project[];
  activeProject: Project | null;
  locale: Locale;
  tr: TFn;
  showToast: (msg: string, ms?: number) => void;
}) {
  const {
    session,
    sessions,
    messages,
    projects,
    activeProject,
    locale,
    tr,
    showToast,
  } = opts;

  type ExportImageTarget = {
    id: string;
    title: string;
    projectId?: string | null;
  };
  const [exportImageTarget, setExportImageTarget] =
    useState<ExportImageTarget | null>(null);
  /** Smart summary poster vs full transcript card. */
  const [exportImageSmart, setExportImageSmart] = useState(true);
  /** Curated visual skin for smart + full export cards. */
  const [exportImageSkin, setExportImageSkin] = useState<ShareCardSkinId>(() =>
    loadExportImageSkinPref(),
  );
  const [exportImageBusy, setExportImageBusy] = useState(false);
  /** Object URL for share-card preview (revoked on close / re-render). */
  const [exportImagePreviewUrl, setExportImagePreviewUrl] = useState<
    string | null
  >(null);
  const [exportImagePreviewError, setExportImagePreviewError] = useState<
    string | null
  >(null);
  /** Honest meta for the last successful preview (skin / layout / bytes). */
  const [exportImagePreviewStamp, setExportImagePreviewStamp] =
    useState<ExportImageBlobStamp | null>(null);
  const exportImagePreviewBlobRef = useRef<Blob | null>(null);
  const exportImagePreviewStampRef = useRef<ExportImageBlobStamp | null>(null);
  /**
   * Freeze chat rows when the export dialog opens so live streaming does not
   * re-trigger rasterization (modal flicker).
   */
  const exportImageMsgsSnapRef = useRef<ChatMessage[] | null>(null);
  const exportImageGenRef = useRef(0);
  const revokeExportImagePreview = useCallback(() => {
    setExportImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    exportImagePreviewBlobRef.current = null;
    exportImagePreviewStampRef.current = null;
    setExportImagePreviewStamp(null);
    setExportImagePreviewError(null);
  }, []);

  const closeExportSessionImage = useCallback(() => {
    if (exportImageBusy) return;
    revokeExportImagePreview();
    exportImageMsgsSnapRef.current = null;
    setExportImageTarget(null);
  }, [exportImageBusy, revokeExportImagePreview]);

  /** Open share-card export (PNG) options dialog. */
  const openExportSessionImage = useCallback(
    (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportImageNoTarget"));
        return;
      }
      // Invalidate any prior session's preview immediately so session B never
      // shows/saves session A's blob while B is still rendering (AC cross-session).
      exportImageGenRef.current += 1;
      revokeExportImagePreview();
      setExportImagePreviewError(null);
      setExportImageBusy(true);

      // Snapshot live transcript once — do not follow streaming updates.
      // Other sessions: null → builder loads via sessionMessages(id).
      const snap =
        id === session.sessionId
          ? (messages as ChatMessage[]).map((m) => ({ ...m }))
          : null;
      exportImageMsgsSnapRef.current = snap;
      setExportImageSmart(true);
      setExportImageSkin(loadExportImageSkinPref());
      setExportImageTarget({
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
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      showToast,
      tr,
      revokeExportImagePreview,
    ],
  );

  /** Build share-card model + PNG blob for the open export dialog. */
  const buildExportImageBlob = useCallback(async () => {
    if (!exportImageTarget) throw new Error("no target");
    const id = exportImageTarget.id;
    const title =
      exportImageTarget.title ||
      sessions.find((s) => s.id === id)?.title ||
      session.title ||
      tr("session.untitled");
    const projectId =
      exportImageTarget.projectId ??
      sessions.find((s) => s.id === id)?.projectId ??
      null;
    const proj =
      projects.find((p) => p.id === projectId) || activeProject || null;

    let msgs = exportImageMsgsSnapRef.current;
    if (!msgs) {
      if (id !== session.sessionId) {
        msgs = (await api.sessionMessages(id)) as ChatMessage[];
      } else {
        msgs = messages as ChatMessage[];
      }
      exportImageMsgsSnapRef.current = msgs.map((m) => ({ ...m }));
    }

    // Resolve session-relative media (`images/1.jpg`) into message attachments —
    // same path chat uses before MarkdownChat / ImageUi render.
    let msgsForExport = msgs;
    if (api.isTauri() && !exportImageSmart) {
      try {
        const rels = collectSessionRelativeMediaRefs(msgs);
        if (rels.length) {
          const list = await api.sessionResolveRelativeMedia(id, rels);
          if (list.length) {
            msgsForExport = applyResolvedSessionMedia(
              msgs.map((m) => ({
                ...m,
                attachments: m.attachments?.map((a) => ({ ...a })),
              })),
              list.map((a) => ({
                path: a.path,
                name: a.name || a.path.split(/[/\\]/).pop() || a.path,
                isDir: !!a.isDir,
              })),
            ) as typeof msgs;
          }
        }
      } catch {
        /* best-effort */
      }
    }

    const projectPath = proj?.path ?? activeProject?.path ?? null;
    let shareMsgs: ShareCardMessage[];
    if (exportImageSmart) {
      shareMsgs = exportableToShareMessages(
        msgsForExport.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        })),
      );
    } else {
      // Mirror lobe ConversationThread path map construction.
      const sessionPathMap = buildSessionFilePathMap(
        msgsForExport as ChatMessage[],
        projectPath,
      );
      shareMsgs = [];
      for (const m of msgsForExport) {
        if (m.role === "tool" || m.marker === "tool_step") continue;
        const atts = (m.attachments ?? []).map((a) => ({
          path: a.path,
          name: a.name || a.path.split(/[/\\]/).pop() || a.path,
          isDir: !!a.isDir,
        }));
        const imagePathMap = mergePathMaps(
          buildInlineMediaPathMap(atts),
          sessionPathMap,
        );
        shareMsgs.push({
          role: m.role,
          content: m.content || "",
          thought: m.thought,
          createdAt: m.createdAt,
          attachments: atts.length ? atts : undefined,
          imagePathMap:
            Object.keys(imagePathMap).length > 0 ? imagePathMap : undefined,
        });
      }
    }

    const logoDataUrl = loadExportLogoPref();
    const result = await buildExportImagePipeline({
      title,
      projectName: proj?.name,
      projectPath,
      sessionId: id,
      messages: shareMsgs,
      smart: exportImageSmart,
      skinId: exportImageSkin,
      logoDataUrl,
      pixelRatio: 2,
      locale,
    });
    const stamp = stampFromPipelineResult(
      { sessionId: id, skinId: exportImageSkin, smart: exportImageSmart },
      {
        skinId: result.skinId,
        mode: result.mode,
        layout: result.layout ?? null,
        byteLength: result.byteLength,
        messageCount: result.messageCount,
      },
    );
    return {
      blob: result.blob,
      title,
      id,
      skinId: result.skinId,
      stamp,
    };
  }, [
    exportImageTarget,
    exportImageSmart,
    exportImageSkin,
    session.sessionId,
    session.title,
    sessions,
    messages,
    projects,
    activeProject,
    locale,
    tr,
  ]);

  // Keep latest builder without re-firing the preview effect on every stream tick.
  const buildExportImageBlobRef = useRef(buildExportImageBlob);
  buildExportImageBlobRef.current = buildExportImageBlob;

  /** Preview refresh: dialog target, smart toggle, or skin change. */
  useEffect(() => {
    if (!exportImageTarget) {
      revokeExportImagePreview();
      exportImageMsgsSnapRef.current = null;
      return;
    }
    const gen = ++exportImageGenRef.current;
    let cancelled = false;
    // Always invalidate prior preview when rebuilding (session / smart / skin).
    // Leaving the old blob makes Save/Copy export the wrong mode or skin.
    revokeExportImagePreview();
    setExportImageBusy(true);
    setExportImagePreviewError(null);
    void (async () => {
      try {
        const built = await buildExportImageBlobRef.current();
        if (cancelled || gen !== exportImageGenRef.current) return;
        // Guard: never attach a blob built for another session id.
        const targetId = exportImageTarget?.id;
        if (targetId && built.id !== targetId) return;
        const { blob, stamp } = built;
        // Honesty: stamp must match the options this effect was built for.
        if (
          !exportImageBlobMatchesOptions(stamp, {
            sessionId: targetId || stamp.sessionId,
            skinId: exportImageSkin,
            smart: exportImageSmart,
          })
        ) {
          return;
        }
        const url = URL.createObjectURL(blob);
        setExportImagePreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        exportImagePreviewBlobRef.current = blob;
        exportImagePreviewStampRef.current = stamp;
        setExportImagePreviewStamp(stamp);
        setExportImagePreviewError(null);
      } catch (e) {
        if (cancelled || gen !== exportImageGenRef.current) return;
        revokeExportImagePreview();
        const resolved = resolveExportImageError(e);
        if (resolved.silent) {
          setExportImagePreviewError(null);
        } else {
          const base = tr(resolved.messageKey as Parameters<typeof tr>[0]);
          setExportImagePreviewError(
            resolved.detail ? `${base}: ${resolved.detail}` : base,
          );
        }
      } finally {
        if (!cancelled && gen === exportImageGenRef.current) {
          setExportImageBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    exportImageTarget?.id,
    exportImageTarget?.title,
    exportImageTarget?.projectId,
    exportImageSmart,
    exportImageSkin,
    revokeExportImagePreview,
    tr,
  ]);

  const exportImageOptionsMatch = exportImageBlobMatchesOptions(
    exportImagePreviewStamp,
    {
      sessionId: exportImageTarget?.id ?? "",
      skinId: exportImageSkin,
      smart: exportImageSmart,
    },
  );
  // Ready for Save/Copy only when preview URL + stamp match current options.
  const exportImageCanAct = canExportImageActions({
    open: !!exportImageTarget,
    hasMatchingBlob: !!exportImagePreviewUrl && exportImageOptionsMatch,
  });
  const exportImagePreviewPhase = deriveExportImagePreviewPhase({
    open: !!exportImageTarget,
    busy: exportImageBusy,
    hasPreviewUrl: !!exportImagePreviewUrl && exportImageOptionsMatch,
    hasError: !!exportImagePreviewError,
  });
  const exportImageMetaParts = buildExportImageMetaParts({
    stamp: exportImageOptionsMatch ? exportImagePreviewStamp : null,
    skinId: exportImageSkin,
    smart: exportImageSmart,
  });
  const exportImageBytesLabel = formatExportImageBytes(
    exportImageOptionsMatch ? exportImagePreviewStamp?.byteLength : null,
  );

  const runExportSessionImage = useCallback(
    async (mode: "download" | "copy") => {
      if (!exportImageTarget) return;
      // Never save a mid-rebuild / stale-skin preview.
      const options = {
        sessionId: exportImageTarget.id,
        skinId: exportImageSkin,
        smart: exportImageSmart,
      };
      const stampOk = exportImageBlobMatchesOptions(
        exportImagePreviewStampRef.current,
        options,
      );
      if (exportImageBusy && !(exportImagePreviewBlobRef.current && stampOk)) {
        return;
      }
      setExportImageBusy(true);
      try {
        let blob = stampOk ? exportImagePreviewBlobRef.current : null;
        let title = exportImageTarget.title;
        let id = exportImageTarget.id;
        // Rebuild when no matching blob (cleared on smart/skin toggle / open).
        if (!blob) {
          const built = await buildExportImageBlob();
          blob = built.blob;
          title = built.title;
          id = built.id;
          exportImagePreviewBlobRef.current = blob;
          exportImagePreviewStampRef.current = built.stamp;
          setExportImagePreviewStamp(built.stamp);
        } else {
          title =
            exportImageTarget.title ||
            sessions.find((s) => s.id === id)?.title ||
            session.title ||
            tr("session.untitled");
        }
        const filename = sessionExportImageFilename(title, id);
        if (mode === "copy") {
          // Prefer native OS clipboard (arboard). WebView ClipboardItem often fails.
          if (api.isTauri()) {
            const b64 = await pngBlobToBase64(blob);
            await api.clipboardWriteImage(b64);
          } else {
            const ok = await copyPngBlob(blob);
            if (!ok) {
              const err = new Error("clipboard blocked");
              (err as Error & { code?: string }).code = "clipboard";
              throw err;
            }
          }
        } else if (api.isTauri()) {
          const b64 = await pngBlobToBase64(blob);
          const result = await api.exportBytesSave({
            bytesBase64: b64,
            defaultName: filename,
            dialogTitle: tr("session.exportImageSaveTitle"),
            filterName: "PNG",
            extensions: ["png"],
          });
          if (result.cancelled) {
            // User dismissed the native save dialog — keep modal open (silent).
            return;
          }
          if (!result.ok) {
            const err = new Error(result.path || "save failed");
            (err as Error & { code?: string }).code = "save_failed";
            throw err;
          }
        } else {
          // Browser / non-Tauri fallback.
          downloadPngBlob(blob, filename);
        }
        revokeExportImagePreview();
        exportImageMsgsSnapRef.current = null;
        setExportImageTarget(null);
      } catch (e) {
        const resolved = resolveExportImageError(e);
        if (resolved.silent) return;
        const base = tr(resolved.messageKey as Parameters<typeof tr>[0]);
        showToast(resolved.detail ? `${base}: ${resolved.detail}` : base);
      } finally {
        setExportImageBusy(false);
      }
    },
    [
      exportImageBusy,
      exportImageTarget,
      exportImageSkin,
      exportImageSmart,
      buildExportImageBlob,
      session.sessionId,
      session.title,
      sessions,
      showToast,
      tr,
      revokeExportImagePreview,
    ],
  );

  const applyExportImageSkin = useCallback((skinId: ShareCardSkinId) => {
    setExportImageSkin(skinId);
    saveExportImageSkinPref(skinId);
  }, []);

  return {
    exportImageTarget,
    exportImageBusy,
    exportImageSmart,
    setExportImageSmart,
    exportImageSkin,
    applyExportImageSkin,
    exportImageCanAct,
    exportImagePreviewPhase,
    exportImagePreviewUrl,
    exportImageOptionsMatch,
    exportImagePreviewError,
    exportImageBytesLabel,
    exportImageMetaParts,
    closeExportSessionImage,
    runExportSessionImage,
    openExportSessionImage,
  };
}
