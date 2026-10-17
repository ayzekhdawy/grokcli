import { describe, expect, it } from "vitest";
import {
  buildParallelTaskComposerText,
  evaluateParallelTaskPreflight,
  PARALLEL_TASK_PROMPT_MAX,
  parallelTaskPreflightMessageKey,
  planParallelTask,
  slugifyParallelTaskName,
  suggestParallelWorktreeName,
} from "./worktreeParallel";

describe("slugifyParallelTaskName", () => {
  it("lowercases and replaces unsafe chars", () => {
    expect(slugifyParallelTaskName("  Fix Login Flow  ")).toBe("fix-login-flow");
    expect(slugifyParallelTaskName("Feat: Foo/Bar!")).toBe("feat-foo-bar");
  });

  it("uses only the first line", () => {
    expect(slugifyParallelTaskName("hello world\nsecond line")).toBe(
      "hello-world",
    );
  });

  it("returns empty for blank / junk", () => {
    expect(slugifyParallelTaskName("")).toBe("");
    expect(slugifyParallelTaskName("   ")).toBe("");
    expect(slugifyParallelTaskName("!!!")).toBe("");
    expect(slugifyParallelTaskName(null)).toBe("");
    expect(slugifyParallelTaskName(undefined)).toBe("");
  });

  it("caps length", () => {
    const long = "a".repeat(80);
    expect(slugifyParallelTaskName(long).length).toBeLessThanOrEqual(40);
  });
});

describe("suggestParallelWorktreeName", () => {
  const fixed = new Date("2026-04-01T12:00:00.000Z");

  it("slugifies title when free", () => {
    expect(
      suggestParallelWorktreeName({
        title: "Parallel UI polish",
        existingNames: [],
        now: fixed,
      }),
    ).toBe("parallel-ui-polish");
  });

  it("falls back to task-<time> without title", () => {
    const name = suggestParallelWorktreeName({
      title: null,
      existingNames: [],
      now: fixed,
    });
    expect(name.startsWith("task-")).toBe(true);
    expect(name).toMatch(/^task-[a-z0-9]+$/);
  });

  it("appends -2/-3 on collision", () => {
    expect(
      suggestParallelWorktreeName({
        title: "feat-x",
        existingNames: ["feat-x", "feat-x-2"],
        now: fixed,
      }),
    ).toBe("feat-x-3");
  });

  it("is case-insensitive against existing", () => {
    expect(
      suggestParallelWorktreeName({
        title: "Feat-X",
        existingNames: ["FEAT-X"],
        now: fixed,
      }),
    ).toBe("feat-x-2");
  });
});

describe("evaluateParallelTaskPreflight", () => {
  const okBase = {
    isTauri: true,
    projectPath: "/Users/me/proj",
    trusted: true,
    gitAvailable: true as boolean | null,
  };

  it("ok when host + project + trusted + git", () => {
    expect(evaluateParallelTaskPreflight(okBase)).toEqual({ ok: true });
  });

  it("host_only when not Tauri", () => {
    expect(
      evaluateParallelTaskPreflight({ ...okBase, isTauri: false }),
    ).toEqual({ ok: false, reason: "host_only" });
  });

  it("no_project when path empty", () => {
    expect(
      evaluateParallelTaskPreflight({ ...okBase, projectPath: "  " }),
    ).toEqual({ ok: false, reason: "no_project" });
    expect(
      evaluateParallelTaskPreflight({ ...okBase, projectPath: null }),
    ).toEqual({ ok: false, reason: "no_project" });
  });

  it("untrusted when trusted === false", () => {
    expect(
      evaluateParallelTaskPreflight({ ...okBase, trusted: false }),
    ).toEqual({ ok: false, reason: "untrusted" });
  });

  it("not_git when gitAvailable === false", () => {
    expect(
      evaluateParallelTaskPreflight({ ...okBase, gitAvailable: false }),
    ).toEqual({ ok: false, reason: "not_git" });
  });

  it("allows unknown git (null) so host can still open create", () => {
    expect(
      evaluateParallelTaskPreflight({ ...okBase, gitAvailable: null }),
    ).toEqual({ ok: true });
  });

  it("maps reasons to message keys", () => {
    expect(parallelTaskPreflightMessageKey("host_only")).toBe(
      "composer.parallelTaskHostOnly",
    );
    expect(parallelTaskPreflightMessageKey("no_project")).toBe(
      "composer.parallelTaskNoProject",
    );
    expect(parallelTaskPreflightMessageKey("untrusted")).toBe(
      "composer.parallelTaskUntrusted",
    );
    expect(parallelTaskPreflightMessageKey("not_git")).toBe(
      "composer.parallelTaskNotGit",
    );
  });
});

describe("planParallelTask", () => {
  it("sanitizes name and nulls empty prompt", () => {
    const p = planParallelTask({ name: "  feat-login  ", firstPrompt: "  " });
    expect(p.name).toBe("feat-login");
    expect(p.firstPrompt).toBeNull();
    expect(p.autoSend).toBe(false);
    expect(p.sessionTitle).toBe("feat-login");
  });

  it("keeps prompt and caps length", () => {
    const long = "x".repeat(PARALLEL_TASK_PROMPT_MAX + 50);
    const p = planParallelTask({
      name: "task-abc",
      firstPrompt: long,
      autoSend: true,
    });
    expect(p.firstPrompt?.length).toBe(PARALLEL_TASK_PROMPT_MAX);
    expect(p.autoSend).toBe(true);
  });

  it("autoSend requires a non-empty prompt", () => {
    expect(
      planParallelTask({ name: "feat-a", firstPrompt: "", autoSend: true })
        .autoSend,
    ).toBe(false);
  });

  it("session title prefers prompt first line for generic task-* names", () => {
    const p = planParallelTask({
      name: "task-k1m2n3",
      firstPrompt: "Ship the parallel worktree flow\nmore detail",
    });
    expect(p.sessionTitle).toBe("Ship the parallel worktree flow");
  });

  it("session title keeps explicit name", () => {
    const p = planParallelTask({
      name: "feat-parallel",
      firstPrompt: "Do the thing",
    });
    expect(p.sessionTitle).toBe("feat-parallel");
  });

  it("throws on illegal name", () => {
    expect(() => planParallelTask({ name: "has space" })).toThrow();
    expect(() => planParallelTask({ name: "" })).toThrow();
  });
});

describe("buildParallelTaskComposerText", () => {
  it("returns body alone without meta", () => {
    expect(buildParallelTaskComposerText("Hello")).toBe("Hello");
    expect(buildParallelTaskComposerText("  Hi  ", {})).toBe("Hi");
  });

  it("prefixes honest branch/path when present", () => {
    expect(
      buildParallelTaskComposerText("Do work", {
        branch: "feat-x",
        path: "/tmp/wt-feat-x",
      }),
    ).toBe(
      "[parallel task · branch: feat-x · cwd: /tmp/wt-feat-x]\n\nDo work",
    );
  });

  it("omits missing bits (never invents)", () => {
    expect(
      buildParallelTaskComposerText("Only branch", { branch: "main" }),
    ).toBe("[parallel task · branch: main]\n\nOnly branch");
    expect(
      buildParallelTaskComposerText("Only path", {
        path: "/repo",
        branch: "  ",
      }),
    ).toBe("[parallel task · cwd: /repo]\n\nOnly path");
  });

  it("empty prompt → empty string", () => {
    expect(buildParallelTaskComposerText("  ")).toBe("");
    expect(buildParallelTaskComposerText("", { branch: "x" })).toBe("");
  });
});
