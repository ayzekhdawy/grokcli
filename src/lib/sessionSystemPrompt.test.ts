import { describe, expect, it } from "vitest";
import {
  SESSION_SYSTEM_PROMPT_MAX_CHARS,
  hasSystemPromptOverride,
  sanitizeSystemPromptOverride,
  systemPromptOverrideLogMeta,
  systemPromptOverrideSpawnArgs,
} from "./sessionSystemPrompt";

describe("sanitizeSystemPromptOverride", () => {
  it("returns empty for nullish / whitespace", () => {
    expect(sanitizeSystemPromptOverride(null)).toBe("");
    expect(sanitizeSystemPromptOverride(undefined)).toBe("");
    expect(sanitizeSystemPromptOverride("")).toBe("");
    expect(sanitizeSystemPromptOverride("   \n\t  ")).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeSystemPromptOverride("  You are a bot  ")).toBe(
      "You are a bot",
    );
    expect(sanitizeSystemPromptOverride("\nline a\nline b\n")).toBe(
      "line a\nline b",
    );
  });

  it("strips NUL bytes", () => {
    expect(sanitizeSystemPromptOverride("a\0b\0c")).toBe("abc");
    expect(sanitizeSystemPromptOverride("\0\0  hi  \0")).toBe("hi");
    expect(sanitizeSystemPromptOverride("\0\0")).toBe("");
  });

  it("clamps to max length after trim + NUL strip", () => {
    const long = "x".repeat(100);
    expect(sanitizeSystemPromptOverride(long, 10)).toBe("x".repeat(10));
    expect(sanitizeSystemPromptOverride("  " + "y".repeat(50) + "  ", 5)).toBe(
      "y".repeat(5),
    );
    // NUL does not count toward retained content after strip.
    expect(sanitizeSystemPromptOverride("a\0b\0c\0d", 3)).toBe("abc");
  });

  it("uses the default 32 KiB soft cap", () => {
    const ok = "a".repeat(SESSION_SYSTEM_PROMPT_MAX_CHARS);
    expect(sanitizeSystemPromptOverride(ok).length).toBe(
      SESSION_SYSTEM_PROMPT_MAX_CHARS,
    );
    const over = "b".repeat(SESSION_SYSTEM_PROMPT_MAX_CHARS + 20);
    expect(sanitizeSystemPromptOverride(over).length).toBe(
      SESSION_SYSTEM_PROMPT_MAX_CHARS,
    );
  });
});

describe("systemPromptOverrideSpawnArgs", () => {
  it("builds top-level --system-prompt-override pair", () => {
    expect(systemPromptOverrideSpawnArgs("You are helpful")).toEqual([
      "--system-prompt-override",
      "You are helpful",
    ]);
  });

  it("omits the flag when empty after sanitize", () => {
    expect(systemPromptOverrideSpawnArgs("")).toEqual([]);
    expect(systemPromptOverrideSpawnArgs(null)).toEqual([]);
    expect(systemPromptOverrideSpawnArgs("   ")).toEqual([]);
    expect(systemPromptOverrideSpawnArgs("\0")).toEqual([]);
  });

  it("does not place override under agent/stdio flags", () => {
    const args = systemPromptOverrideSpawnArgs("be concise");
    expect(args[0]).toBe("--system-prompt-override");
    expect(args).not.toContain("agent");
    expect(args).not.toContain("stdio");
    expect(args).not.toContain("--system-prompt");
  });
});

describe("hasSystemPromptOverride", () => {
  it("is true only for non-empty sanitized text", () => {
    expect(hasSystemPromptOverride("hi")).toBe(true);
    expect(hasSystemPromptOverride("  ")).toBe(false);
    expect(hasSystemPromptOverride(null)).toBe(false);
    expect(hasSystemPromptOverride("\0")).toBe(false);
  });
});

describe("systemPromptOverrideLogMeta", () => {
  it("never returns the prompt body — only char count", () => {
    const secret = "sk-super-secret-api-key-value";
    const meta = systemPromptOverrideLogMeta(secret);
    expect(meta).toEqual({ chars: secret.length });
    expect(JSON.stringify(meta)).not.toContain("sk-");
    expect(JSON.stringify(meta)).not.toContain("secret");
    expect(systemPromptOverrideLogMeta("  ")).toBe(null);
    expect(systemPromptOverrideLogMeta(null)).toBe(null);
  });
});
