import { describe, expect, it } from "vitest";
import {
  COMMON_ALLOWED_TOOLS,
  allowedToolsCliValue,
  allowedToolsEqual,
  allowedToolsSpawnArgs,
  bothToolListsSet,
  isToolAllowed,
  normalizeAllowedTools,
  parseAllowedToolsInput,
  toggleAllowedTool,
} from "./allowedTools";

describe("normalizeAllowedTools", () => {
  it("accepts arrays and comma-separated strings", () => {
    expect(normalizeAllowedTools(["web_search", "  write  "])).toEqual([
      "web_search",
      "write",
    ]);
    expect(normalizeAllowedTools("web_search, write, Agent")).toEqual([
      "web_search",
      "write",
      "Agent",
    ]);
  });

  it("dedupes case-insensitively, keeping first spelling", () => {
    expect(
      normalizeAllowedTools(["Web_Search", "web_search", "WRITE", "write"]),
    ).toEqual(["Web_Search", "WRITE"]);
  });

  it("splits embedded commas in array items", () => {
    expect(normalizeAllowedTools(["a,b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns empty for nullish / garbage", () => {
    expect(normalizeAllowedTools(null)).toEqual([]);
    expect(normalizeAllowedTools(undefined)).toEqual([]);
    expect(normalizeAllowedTools(true)).toEqual([]);
    expect(normalizeAllowedTools("")).toEqual([]);
    expect(normalizeAllowedTools([""])).toEqual([]);
  });
});

describe("parseAllowedToolsInput", () => {
  it("parses freeform input", () => {
    expect(parseAllowedToolsInput("  web_search,run_terminal_command , ")).toEqual(
      ["web_search", "run_terminal_command"],
    );
  });
});

describe("allowedToolsCliValue / spawnArgs", () => {
  it("omits flag when empty", () => {
    expect(allowedToolsCliValue([])).toBeNull();
    expect(allowedToolsSpawnArgs([])).toEqual([]);
  });

  it("builds comma-separated CLI value and --tools flag", () => {
    expect(allowedToolsCliValue(["web_search", "write"])).toBe(
      "web_search,write",
    );
    expect(allowedToolsSpawnArgs(["web_search", "write"])).toEqual([
      "--tools",
      "web_search,write",
    ]);
  });
});

describe("toggle / membership", () => {
  it("toggles tools case-insensitively", () => {
    const a = toggleAllowedTool([], "web_search");
    expect(a).toEqual(["web_search"]);
    expect(isToolAllowed(a, "WEB_SEARCH")).toBe(true);
    const b = toggleAllowedTool(a, "Web_Search");
    expect(b).toEqual([]);
  });

  it("preserves existing spelling when removing via different case", () => {
    expect(toggleAllowedTool(["Agent", "write"], "agent")).toEqual(["write"]);
  });
});

describe("allowedToolsEqual", () => {
  it("compares order- and case-insensitively", () => {
    expect(allowedToolsEqual(["a", "b"], ["B", "A"])).toBe(true);
    expect(allowedToolsEqual(["a"], ["a", "b"])).toBe(false);
    expect(allowedToolsEqual(null, [])).toBe(true);
  });
});

describe("bothToolListsSet", () => {
  it("is true only when both lists are non-empty", () => {
    expect(bothToolListsSet([], [])).toBe(false);
    expect(bothToolListsSet(["write"], [])).toBe(false);
    expect(bothToolListsSet([], ["write"])).toBe(false);
    expect(bothToolListsSet(["write"], ["web_search"])).toBe(true);
  });
});

describe("catalog constants", () => {
  it("exposes common chips shared with denylist", () => {
    expect(COMMON_ALLOWED_TOOLS.map((t) => t.id)).toContain(
      "run_terminal_command",
    );
    expect(
      COMMON_ALLOWED_TOOLS.find((t) => t.id === "run_terminal_command")
        ?.caution,
    ).toBe(true);
  });
});
