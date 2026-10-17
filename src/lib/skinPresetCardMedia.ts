/**
 * Appearance preset-card fill: still CSS background, or a real <video>
 * for mp4/webm (CSS cannot paint video; ffmpeg posters are optional).
 */

import { mediaVideoPoster } from "@/lib/api/fs";
import type { SkinPresetListItem } from "@/lib/api/skin";
import { pathToPreviewUrl } from "@/lib/filePreviewSrc";
import {
  resolveImageSrc,
  resolveImageSrcSync,
} from "@/lib/imageSrc";
import {
  getThemeSkinMeta,
  isThemeSkinId,
  type ThemeSkinId,
} from "@/lib/themeSkin";
import type { CSSProperties } from "react";

export type PresetCardMedia = {
  thumbSrc?: string;
  videoSrc?: string;
};

export function isVideoAssetPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".mp4") || lower.endsWith(".webm");
}

export function cssBackgroundUrl(src: string): string {
  return `url(${JSON.stringify(src)})`;
}

function skinFill(p: SkinPresetListItem): string {
  const skinId = (isThemeSkinId(p.skin) ? p.skin : "default") as ThemeSkinId;
  return getThemeSkinMeta(skinId).swatch;
}

export function presetCardStyle(
  p: SkinPresetListItem,
  media?: PresetCardMedia,
): CSSProperties {
  if (media?.videoSrc) {
    return { background: skinFill(p) };
  }
  if (media?.thumbSrc) {
    return {
      backgroundImage: cssBackgroundUrl(media.thumbSrc),
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background: skinFill(p) };
}

async function viewableSrc(
  path: string,
  kind?: "image" | "video",
): Promise<string | null> {
  if (kind === "video") {
    return (
      (await pathToPreviewUrl(path, "video")) || (await resolveImageSrc(path))
    );
  }
  return resolveImageSrcSync(path) || (await resolveImageSrc(path));
}

/** Still thumb for CSS; videos resolve a loopback media URL for <video>. */
export async function resolvePresetCardMedia(
  p: SkinPresetListItem,
): Promise<PresetCardMedia> {
  const wall = p.wallpaperPath;
  if (wall && isVideoAssetPath(wall)) {
    const videoSrc = (await viewableSrc(wall, "video")) ?? undefined;
    let thumbSrc: string | undefined;
    const stillThumb =
      p.thumbPath && !isVideoAssetPath(p.thumbPath) ? p.thumbPath : null;
    if (stillThumb) {
      thumbSrc = (await viewableSrc(stillThumb, "image")) ?? undefined;
    }
    if (!thumbSrc) {
      try {
        const poster = await mediaVideoPoster(wall);
        if (poster?.posterPath) {
          thumbSrc = (await viewableSrc(poster.posterPath, "image")) ?? undefined;
        }
      } catch {
        /* ffmpeg missing / path denied — <video> still plays */
      }
    }
    return { videoSrc, thumbSrc };
  }
  const candidates = [p.thumbPath, p.wallpaperPath].filter(
    (x): x is string => !!x && !isVideoAssetPath(x),
  );
  for (const path of candidates) {
    const src = await viewableSrc(path, "image");
    if (src) return { thumbSrc: src };
  }
  return {};
}
