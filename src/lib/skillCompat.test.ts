import { describe, expect, it } from "vitest";
import {
  allowClaudeDiscover,
  allowCursorDiscover,
  compatSkillKind,
  countHiddenCompatSkills,
  effectiveDiscoverExternal,
  filterDiscoveredSkills,
  isClaudeCompatSkill,
  isCompatExternalSkill,
  isCursorCompatSkill,
  shouldIncludeDiscoveredSkill,
  withDiscoverAppPref,
} from "./skillCompat";

describe("compat skill path / source", () => {
  it("detects Claude paths on Unix and Windows", () => {
    expect(
      isClaudeCompatSkill({
        path: "/Users/me/.claude/skills/pdf/SKILL.md",
        source: "user",
      }),
    ).toBe(true);
    expect(
      isClaudeCompatSkill({
        path: "C:\\Users\\me\\.claude\\skills\\web\\SKILL.md",
        source: "unknown",
      }),
    ).toBe(true);
    expect(isClaudeCompatSkill({ source: "claude" })).toBe(true);
    expect(isClaudeCompatSkill({ source: "Claude-Code" })).toBe(true);
  });

  it("detects Cursor paths", () => {
    expect(
      isCursorCompatSkill({
        path: "/Users/me/.cursor/skills/review/SKILL.md",
      }),
    ).toBe(true);
    expect(isCursorCompatSkill({ source: "cursor" })).toBe(true);
    expect(compatSkillKind({ source: "cursor-plugin" })).toBe("cursor");
  });

  it("does not treat Grok / project skills as compat", () => {
    expect(
      isCompatExternalSkill({
        source: "user",
        path: "/Users/me/.grok/skills/help/SKILL.md",
      }),
    ).toBe(false);
    expect(
      isCompatExternalSkill({
        source: "project",
        path: "D:/work/app/.grok/skills/local/SKILL.md",
      }),
    ).toBe(false);
    expect(
      isCompatExternalSkill({
        source: "plugin",
        path: "/Users/me/.grok/plugins/foo/skills/bar/SKILL.md",
      }),
    ).toBe(false);
    expect(
      isCompatExternalSkill({
        source: "user",
        path: "/Users/me/.agents/skills/portable/SKILL.md",
      }),
    ).toBe(false);
  });
});

describe("discover flags", () => {
  it("defaults to allow when flags are missing", () => {
    expect(allowClaudeDiscover({})).toBe(true);
    expect(allowCursorDiscover({})).toBe(true);
    expect(effectiveDiscoverExternal({})).toBe(true);
    expect(
      shouldIncludeDiscoveredSkill(
        { path: "/Users/me/.claude/skills/x/SKILL.md" },
        {},
      ),
    ).toBe(true);
  });

  it("hides Claude when config.toml says skills = false", () => {
    const flags = { claudeSkills: false as const };
    expect(allowClaudeDiscover(flags)).toBe(false);
    expect(allowCursorDiscover(flags)).toBe(true);
    expect(effectiveDiscoverExternal(flags)).toBe(false);
    expect(
      shouldIncludeDiscoveredSkill(
        { path: "/Users/me/.claude/skills/x/SKILL.md" },
        flags,
      ),
    ).toBe(false);
    expect(
      shouldIncludeDiscoveredSkill(
        { path: "/Users/me/.grok/skills/help/SKILL.md", source: "user" },
        flags,
      ),
    ).toBe(true);
  });

  it("App overlay off hides both vendors", () => {
    const flags = { appPref: false as const };
    expect(effectiveDiscoverExternal(flags)).toBe(false);
    const rows = [
      { name: "keep", source: "user", path: "/u/.grok/skills/keep/SKILL.md" },
      { name: "claude", path: "/u/.claude/skills/c/SKILL.md" },
      { name: "cursor", path: "/u/.cursor/skills/k/SKILL.md" },
    ];
    expect(filterDiscoveredSkills(rows, flags).map((s) => s.name)).toEqual([
      "keep",
    ]);
    expect(countHiddenCompatSkills(rows, flags)).toBe(2);
  });

  it("explicit true does not override a false config key", () => {
    expect(
      allowClaudeDiscover({ appPref: true, claudeSkills: false }),
    ).toBe(false);
  });

  it("optimistic appPref flip keeps vendor flags and recomputes effective", () => {
    const onButConfigOff = withDiscoverAppPref(
      { appPref: false, claudeSkills: false, cursorSkills: true },
      true,
    );
    expect(onButConfigOff.appPref).toBe(true);
    expect(onButConfigOff.claudeSkills).toBe(false);
    expect(onButConfigOff.cursorSkills).toBe(true);
    expect(onButConfigOff.effective).toBe(false);

    const off = withDiscoverAppPref(
      { appPref: true, claudeSkills: true, cursorSkills: true },
      false,
    );
    expect(off.appPref).toBe(false);
    expect(off.effective).toBe(false);

    const on = withDiscoverAppPref(
      { appPref: false, claudeSkills: null, cursorSkills: null },
      true,
    );
    expect(on.appPref).toBe(true);
    expect(on.effective).toBe(true);
  });
});
