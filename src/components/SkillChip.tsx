/**
 * Unified skill tag: icon + name.
 * Used in composer (contenteditable=false chips) and user message history.
 */

import { IconImagine, IconSkills } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Composer + message chips: Tabler stroke icons need ~14px to match 12px label. */
export const SKILL_CHIP_ICON_SM = 14;
export const SKILL_CHIP_ICON_MD = 16;

const TOOL_PATH =
  "M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5";

const IMAGINE_PATHS = [
  "M6 21l15 -15l-3 -3l-15 15l3 3",
  "M15 6l3 3",
  "M9 3a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2",
  "M19 13a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2",
];

function isImagineSkill(name: string): boolean {
  return name.trim().toLowerCase() === "imagine";
}

/** Inline SVG for contenteditable chips (same glyphs as {@link SkillChip}). */
export function skillChipGlyphSvg(
  name: string,
  size = SKILL_CHIP_ICON_SM,
): string {
  const paths = isImagineSkill(name) ? IMAGINE_PATHS : [TOOL_PATH];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}

export function SkillChip({
  name,
  size = "md",
  className,
  kind = "skill",
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
  kind?: "skill" | "plugin";
}) {
  const iconSize = size === "sm" ? SKILL_CHIP_ICON_SM : SKILL_CHIP_ICON_MD;
  const Icon = isImagineSkill(name) ? IconImagine : IconSkills;
  return (
    <span
      className={cn(
        "skill-chip",
        size === "sm" && "skill-chip--sm",
        kind === "plugin" && "skill-chip--plugin",
        className,
      )}
      data-skill={kind === "skill" ? name : undefined}
      data-plugin={kind === "plugin" ? name : undefined}
      contentEditable={false}
      suppressContentEditableWarning
    >
      <Icon size={iconSize} className="skill-chip__icon" />
      <span className="skill-chip__name">{name}</span>
    </span>
  );
}
