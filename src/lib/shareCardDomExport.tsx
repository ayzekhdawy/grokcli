/**
 * Full-transcript share card via offscreen DOM + screenshot.
 *
 * Reuses chat renderers (MarkdownChat + AttachmentCard) so path maps,
 * ImageUi media:// resolution, and GFM tables match the live transcript.
 */

import { createRoot, type Root } from "react-dom/client";
import { useEffect, useMemo } from "react";
import { toBlob } from "html-to-image";
import { MarkdownChat } from "@/components/lobe-chat/MarkdownChat";
import { AttachmentCard } from "@/components/AttachmentCard";
import { ImageUi, imageUiLabels } from "@/components/ImageUi";
import {
  buildInlineMediaPathMap,
  filterAttachmentsNotInlined,
  isImagePath,
  isMediaPath,
  pathBasename,
  type Attachment,
} from "@/lib/attachments";
import { mergePathMaps } from "@/lib/sessionPathMap";
import { createT, type Locale, isLocale } from "@/i18n";
import { revealInOsLabel } from "@/lib/appPlatform";
import {
  getShareCardSkin,
  skinBodyFont,
  skinMetaFont,
  type ShareCardSkin,
  type ShareCardSkinId,
} from "@/lib/shareCardSkins";
import type { ShareCardModel } from "@/lib/sessionExportImage";
import { GROK_APP_SHARE_FOOTER } from "@/lib/sessionExportImage";

function roleLabel(role: string): string {
  if (role === "user") return "You";
  if (role === "assistant") return "Grok";
  if (role === "tool") return "Tool";
  return role;
}

function toLocale(raw: string | null | undefined): Locale {
  if (raw && isLocale(raw)) return raw;
  return "en";
}

/** One message body — same path-map wiring as lobe AssistantMessageBody. */
function ShareMessageBody({
  content,
  attachments,
  imagePathMap,
  projectPath,
  locale,
}: {
  content: string;
  attachments?: Attachment[] | null;
  imagePathMap?: Record<string, string> | null;
  projectPath?: string | null;
  locale: Locale;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const attachLabels = useMemo(
    () => ({
      open: tr("attach.open"),
      reveal: revealInOsLabel(tr),
      copyPath: tr("attach.copyPath"),
      copyImage: tr("attach.copyImage"),
      addToComposer: tr("attach.addToComposer"),
    }),
    [tr],
  );

  const pathMap = useMemo(() => {
    const fromAtts = buildInlineMediaPathMap(attachments);
    const merged = mergePathMaps(fromAtts, imagePathMap);
    return Object.keys(merged).length ? merged : undefined;
  }, [attachments, imagePathMap]);

  const bottomAtts = useMemo(
    () => filterAttachmentsNotInlined(content, attachments),
    [content, attachments],
  );

  const { bottomImages, bottomFiles, galleryPaths } = useMemo(() => {
    const list = bottomAtts ?? [];
    const images = list.filter((x) => !x.isDir && isImagePath(x.path));
    const files = list.filter((x) => x.isDir || !isImagePath(x.path));
    return {
      bottomImages: images,
      bottomFiles: files,
      galleryPaths: images.map((x) => x.path),
    };
  }, [bottomAtts]);

  const imageLabels = useMemo(() => imageUiLabels(locale), [locale]);

  const hasBody = !!(content || "").trim();
  const hasAtts = bottomImages.length > 0 || bottomFiles.length > 0;
  if (!hasBody && !hasAtts) return null;

  return (
    <>
      {hasBody ? (
        <div className="share-card-export__md">
          <MarkdownChat
            locale={locale}
            streaming={false}
            // Must stay true: pathCards=false skips ImageUi for `images/1.jpg` etc.
            pathCards
            imagePathMap={pathMap}
            projectPath={projectPath}
          >
            {content}
          </MarkdownChat>
        </div>
      ) : null}
      {bottomImages.length > 0 ? (
        <div
          className="share-card-export__atts share-card-export__atts--images"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: hasBody ? 10 : 0,
            alignItems: "flex-start",
          }}
        >
          {bottomImages.map((a) => (
            <ImageUi
              key={a.path}
              className="md-body__img md-body__img--card"
              src={a.path}
              alt={a.name || pathBasename(a.path)}
              path={a.path}
              gallery={galleryPaths}
              labels={imageLabels}
            />
          ))}
        </div>
      ) : null}
      {bottomFiles.length > 0 ? (
        <div
          className="share-card-export__atts"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: hasBody || bottomImages.length ? 10 : 0,
          }}
        >
          {bottomFiles.map((a) => (
            <AttachmentCard
              key={a.path}
              attachment={a}
              variant={!a.isDir && isMediaPath(a.path) ? "card" : "chip"}
              labels={attachLabels}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

/** True when bitmap is decoded and drawable (not just network complete). */
function imgDecoded(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
}

function waitImgSettled(
  img: HTMLImageElement,
  timeoutMs = 15_000,
): Promise<void> {
  if (imgDecoded(img) || (img.complete && img.naturalWidth === 0)) {
    // Already decoded, or hard-failed (broken icon / empty).
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const t = window.setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    const done = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(t);
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
    };
    img.addEventListener("load", done);
    img.addEventListener("error", done);
  });
}

/**
 * Wait until every <img> under root is settled (decoded with naturalWidth>0,
 * or complete-but-broken). Only checking `complete` is insufficient — empty
 * frames often report complete with naturalWidth 0.
 */
async function waitAllImagesDecoded(
  root: HTMLElement,
  overallTimeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + overallTimeoutMs;
  // ImageUi may mount / swap src after first paint.
  let stableRounds = 0;
  while (Date.now() < deadline) {
    const imgs = Array.from(root.querySelectorAll("img"));
    if (!imgs.length) {
      await new Promise((r) => setTimeout(r, 80));
      if (!root.querySelectorAll("img").length) {
        stableRounds += 1;
        if (stableRounds >= 3) return;
        continue;
      }
    }
    stableRounds = 0;
    await Promise.all(
      Array.from(root.querySelectorAll("img")).map((img) =>
        waitImgSettled(img, Math.max(800, deadline - Date.now())),
      ),
    );
    const list = Array.from(root.querySelectorAll("img"));
    const allComplete = list.every((img) => img.complete);
    if (allComplete) {
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      await new Promise((r) => setTimeout(r, 50));
      // If React swapped src after decode, loop again.
      const stillLoading = Array.from(root.querySelectorAll("img")).some(
        (img) => !img.complete,
      );
      if (!stillLoading) return;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
}

/**
 * html-to-image cannot embed Tauri `media://` / `asset://` into the PNG.
 * Convert every loaded bitmap to a data: URL via canvas before capture.
 */
async function inlineImagesAsDataUrls(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  for (const img of imgs) {
    const src = img.currentSrc || img.src || "";
    if (!src || src.startsWith("data:")) continue;

    // Prefer canvas re-encode when the browser already decoded the bitmap.
    if (imgDecoded(img)) {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          // JPEG for photos; PNG if alpha might matter (icons/png logos).
          const usePng =
            /\.png(\?|$)/i.test(src) ||
            src.includes("image/png") ||
            img.naturalWidth * img.naturalHeight < 400 * 400;
          const dataUrl = usePng
            ? c.toDataURL("image/png")
            : c.toDataURL("image/jpeg", 0.92);
          if (dataUrl && dataUrl.length > 32) {
            img.src = dataUrl;
            await waitImgSettled(img, 5_000);
            continue;
          }
        }
      } catch {
        /* tainted canvas — try fetch */
      }
    }

    // Fetch media:// / http(s) and rewrite as data URL.
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ""));
        fr.onerror = () => reject(new Error("FileReader failed"));
        fr.readAsDataURL(blob);
      });
      if (dataUrl.startsWith("data:")) {
        img.src = dataUrl;
        await waitImgSettled(img, 5_000);
      }
    } catch {
      /* leave as-is; capture may show empty frame */
    }
  }
}

function ShareCardExportView({
  model,
  skin,
  onReady,
}: {
  model: ShareCardModel;
  skin: ShareCardSkin;
  onReady: () => void;
}) {
  const locale = toLocale(model.locale);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Initial mount — give MarkdownChat / ImageUi a tick to attach imgs.
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      await new Promise((r) => setTimeout(r, 50));
      const root = document.querySelector(
        "[data-share-card-root]",
      ) as HTMLElement | null;
      if (root) {
        await waitAllImagesDecoded(root, 20_000);
      }
      if (!cancelled) onReady();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [onReady, model]);

  const font = skinBodyFont(skin);
  const metaFont = skinMetaFont(skin);
  const width = model.widthPx;

  return (
    <article
      data-share-card-root
      className="share-card-export"
      style={{
        boxSizing: "border-box",
        width,
        background: `linear-gradient(180deg, ${skin.bg0} 0%, ${skin.bg1} 100%)`,
        color: skin.text,
        fontFamily: font,
        borderRadius: skin.radius,
        border: `1px solid ${skin.borderStrong}`,
        overflow: "hidden",
        // Theme tokens for .md-body / .sd-body so tables & code match skin.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ["--text-primary" as any]: skin.text,
        ["--text-secondary" as any]: skin.muted,
        ["--text-tertiary" as any]: skin.faint,
        ["--border-subtle" as any]: skin.border,
        ["--bg-elevated" as any]: skin.surface,
        ["--bg-hover" as any]: skin.footerBg,
        ["--accent" as any]: skin.accent,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 20px",
          background: skin.footerBg,
          borderBottom: `1px solid ${skin.border}`,
        }}
      >
        {model.logoDataUrl ? (
          <img
            src={model.logoDataUrl}
            alt=""
            width={34}
            height={34}
            style={{
              width: 34,
              height: 34,
              borderRadius: skin.radiusSm,
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: skin.radiusSm,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 16,
              color: "#fff",
              background: `linear-gradient(135deg, ${skin.logo0}, ${skin.logo1})`,
            }}
          >
            G
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 650,
              lineHeight: 1.3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {model.title}
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              color: skin.muted,
              fontFamily: metaFont,
            }}
          >
            {[
              model.projectName,
              model.exportedAt.slice(0, 19).replace("T", " "),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </header>

      <div style={{ padding: "12px 18px 8px" }}>
        {model.truncatedCount > 0 ? (
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              color: skin.faint,
            }}
          >
            +{model.truncatedCount} earlier messages omitted
          </p>
        ) : null}

        {model.messages.map((m, i) => {
          const isUser = m.role === "user";
          return (
            <section
              key={i}
              style={{
                margin: "0 0 12px",
                marginLeft: isUser ? 28 : 0,
                padding: "12px 14px",
                borderRadius: skin.radiusSm,
                background: isUser ? skin.surfaceUser : skin.surface,
                border: `1px solid ${skin.border}`,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform:
                    skin.typeFace === "mono" ? "none" : "uppercase",
                  color: skin.faint,
                  marginBottom: 8,
                  fontFamily: metaFont,
                }}
              >
                {roleLabel(m.role)}
              </div>
              {model.includeThoughts && m.thought ? (
                <div
                  style={{
                    marginBottom: 8,
                    padding: "8px 10px",
                    borderRadius: Math.max(4, skin.radiusSm - 2),
                    background: skin.footerBg,
                    border: `1px solid ${skin.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: skin.faint,
                      marginBottom: 4,
                      textTransform: "uppercase",
                    }}
                  >
                    Thinking
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: skin.muted,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.thought}
                  </div>
                </div>
              ) : null}
              <ShareMessageBody
                content={m.content || ""}
                attachments={m.attachments}
                imagePathMap={m.imagePathMap}
                projectPath={model.projectPath}
                locale={locale}
              />
            </section>
          );
        })}
      </div>

      <footer
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "12px 18px 14px",
          borderTop: `1px solid ${skin.border}`,
          background: skin.footerBg,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: skin.faint,
            fontFamily: metaFont,
          }}
        >
          {model.footerText || GROK_APP_SHARE_FOOTER}
        </span>
      </footer>
    </article>
  );
}

export type DomRasterizeOptions = {
  pixelRatio?: number;
  skinId?: ShareCardSkinId | string | null;
};

/**
 * Render the full share card with chat markdown components and capture PNG.
 */
export async function rasterizeShareCardDomPng(
  model: ShareCardModel,
  opts?: DomRasterizeOptions,
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("rasterizeShareCardDomPng requires a DOM");
  }

  const skin = getShareCardSkin(opts?.skinId);
  const pixelRatio = opts?.pixelRatio ?? 2;
  const width = model.widthPx;

  const host = document.createElement("div");
  host.setAttribute("data-share-card-export-host", "1");
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${width}px`,
    opacity: "1",
    pointerEvents: "none",
    zIndex: "0",
    overflow: "visible",
  });
  document.body.appendChild(host);

  let root: Root | null = null;
  try {
    root = createRoot(host);
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(
        () => reject(new Error("share card DOM layout timeout")),
        25_000,
      );
      try {
        root!.render(
          <ShareCardExportView
            model={model}
            skin={skin}
            onReady={() => {
              window.clearTimeout(t);
              resolve();
            }}
          />,
        );
      } catch (e) {
        window.clearTimeout(t);
        reject(e);
      }
    });

    const card = host.querySelector(
      "[data-share-card-root]",
    ) as HTMLElement | null;
    if (!card) throw new Error("share card root missing");
    void card.offsetHeight;

    // Second pass: ImageUi may still be resolving media:// after first ready.
    await waitAllImagesDecoded(card, 15_000);
    // media:// / asset:// do not embed in html-to-image — must be data: first.
    await inlineImagesAsDataUrls(card);
    await waitAllImagesDecoded(card, 8_000);
    // Layout settle after data-url swap (aspect frames).
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    await new Promise((r) => setTimeout(r, 40));
    void card.offsetHeight;

    const blob = await toBlob(card, {
      pixelRatio,
      cacheBust: true,
      backgroundColor: skin.bg0,
      width: card.offsetWidth || width,
      height: Math.max(card.scrollHeight, card.offsetHeight),
      style: {
        transform: "none",
        opacity: "1",
      },
      skipFonts: false,
      // Prefer embedding current data: sources we inlined above.
      includeQueryParams: true,
    });

    if (!blob || blob.size < 256) {
      throw new Error("html-to-image produced empty blob");
    }
    return blob;
  } finally {
    try {
      root?.unmount();
    } catch {
      /* ignore */
    }
    host.remove();
  }
}
