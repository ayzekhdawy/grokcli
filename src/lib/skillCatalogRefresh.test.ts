import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDebouncedSkillsReload,
  pathSuggestsSkillCatalogChange,
  textSuggestsSkillCatalogChange,
  toolEventSuggestsSkillCatalogChange,
} from "./skillCatalogRefresh";

describe("pathSuggestsSkillCatalogChange", () => {
  it("matches SKILL.md under user skills", () => {
    expect(
      pathSuggestsSkillCatalogChange(
        "/Users/me/.grok/skills/hello-world/SKILL.md",
      ),
    ).toBe(true);
  });

  it("matches project and vendor skill roots", () => {
    expect(
      pathSuggestsSkillCatalogChange(
        "/repo/.agents/skills/review/SKILL.md",
      ),
    ).toBe(true);
    expect(
      pathSuggestsSkillCatalogChange(
        "C:\\Users\\me\\.claude\\skills\\foo\\SKILL.md",
      ),
    ).toBe(true);
  });

  it("matches skill directory path (create without file yet)", () => {
    expect(
      pathSuggestsSkillCatalogChange("/Users/me/.grok/skills/new-skill"),
    ).toBe(true);
  });

  it("matches plugin install trees", () => {
    expect(
      pathSuggestsSkillCatalogChange(
        "/Users/me/.grok/installed-plugins/agent-plugin-codex/skills/x/SKILL.md",
      ),
    ).toBe(true);
  });

  it("rejects unrelated paths", () => {
    expect(pathSuggestsSkillCatalogChange("/repo/src/App.tsx")).toBe(false);
    expect(pathSuggestsSkillCatalogChange("")).toBe(false);
    expect(pathSuggestsSkillCatalogChange(null)).toBe(false);
  });
});

describe("textSuggestsSkillCatalogChange", () => {
  it("matches common install command phrases", () => {
    expect(textSuggestsSkillCatalogChange("grok plugin install foo --trust")).toBe(
      true,
    );
    expect(textSuggestsSkillCatalogChange("npx skills add owner/repo")).toBe(true);
    expect(textSuggestsSkillCatalogChange("run /create-skill")).toBe(true);
  });

  it("rejects ordinary shell", () => {
    expect(textSuggestsSkillCatalogChange("git status")).toBe(false);
  });
});

describe("toolEventSuggestsSkillCatalogChange", () => {
  it("requires terminal success status", () => {
    expect(
      toolEventSuggestsSkillCatalogChange({
        status: "in_progress",
        path: "/Users/me/.grok/skills/x/SKILL.md",
      }),
    ).toBe(false);
    expect(
      toolEventSuggestsSkillCatalogChange({
        status: "failed",
        path: "/Users/me/.grok/skills/x/SKILL.md",
      }),
    ).toBe(false);
    expect(
      toolEventSuggestsSkillCatalogChange({
        status: "completed",
        path: "/Users/me/.grok/skills/x/SKILL.md",
      }),
    ).toBe(true);
  });

  it("matches install title without path", () => {
    expect(
      toolEventSuggestsSkillCatalogChange({
        status: "completed",
        title: "run_terminal_command: plugin install chatcut --trust",
      }),
    ).toBe(true);
  });

  it("ignores completed unrelated tools", () => {
    expect(
      toolEventSuggestsSkillCatalogChange({
        status: "completed",
        path: "/repo/README.md",
        title: "search_replace",
      }),
    ).toBe(false);
  });
});

describe("createDebouncedSkillsReload", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses multiple schedules into one reload", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const d = createDebouncedSkillsReload(reload, 500);
    d.schedule();
    d.schedule();
    d.schedule();
    expect(reload).not.toHaveBeenCalled();
    expect(d.isPending()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(d.isPending()).toBe(false);
  });

  it("cancel prevents the reload", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const d = createDebouncedSkillsReload(reload, 300);
    d.schedule();
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(reload).not.toHaveBeenCalled();
  });
});
