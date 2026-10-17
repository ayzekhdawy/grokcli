import { describe, expect, it } from "vitest";
import { skillChipGlyphSvg } from "./SkillChip";

describe("skillChipGlyphSvg", () => {
  it("renders a 14px tool glyph for ordinary skills", () => {
    const svg = skillChipGlyphSvg("create-skill");
    expect(svg).toContain('width="14"');
    expect(svg).toContain("M7 10h3v-3");
    expect(svg).not.toContain("M6 21l15 -15");
  });

  it("uses the imagine wand for the imagine skill", () => {
    const svg = skillChipGlyphSvg("Imagine");
    expect(svg).toContain("M6 21l15 -15");
    expect(svg).not.toContain("M7 10h3v-3");
  });
});
