import { describe, expect, it } from "vitest";
import {
  COMMON_DISALLOWED_TOOLS,
  WEB_SEARCH_TOOLS,
  disallowedToolsCliValue,
  disallowedToolsEqual,
  disallowedToolsSpawnArgs,
  effectiveDisallowedTools,
  isToolDisallowed,
  isWebSearchTool,
  normalizeDisallowedTools,
  normalizeToolId,
  parseDisallowedToolsInput,
  toggleDisallowedTool,
} from "./disallowedTools";

describe("normalizeToolId", () => {
  it("trims and rejects empty / non-string", () => {
    expect(normalizeToolId("  web_search  ")).toBe("web_search");
    expect(normalizeToolId("")).toBeNull();
    expect(normalizeToolId("   ")).toBeNull();
    expect(normalizeToolId(null)).toBeNull();
    expect(normalizeToolId(undefined)).toBeNull();
    expect(normalizeToolId(42)).toBeNull();
  });
});

describe("normalizeDisallowedTools", () => {
  it("accepts arrays and comma-separated strings", () => {
    expect(normalizeDisallowedTools(["web_search", "  write  "])).toEqual([
      "web_search",
      "write",
    ]);
    expect(normalizeDisallowedTools("web_search, write, Agent")).toEqual([
      "web_search",
      "write",
      "Agent",
    ]);
  });

  it("dedupes case-insensitively, keeping first spelling", () => {
    expect(
      normalizeDisallowedTools(["Web_Search", "web_search", "WRITE", "write"]),
    ).toEqual(["Web_Search", "WRITE"]);
  });

  it("splits embedded commas in array items", () => {
    expect(normalizeDisallowedTools(["a,b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns empty for nullish / garbage", () => {
    expect(normalizeDisallowedTools(null)).toEqual([]);
    expect(normalizeDisallowedTools(undefined)).toEqual([]);
    expect(normalizeDisallowedTools(true)).toEqual([]);
    expect(normalizeDisallowedTools("")).toEqual([]);
    expect(normalizeDisallowedTools([""])).toEqual([]);
  });
});

describe("parseDisallowedToolsInput", () => {
  it("parses freeform input", () => {
    expect(parseDisallowedToolsInput("  web_search,run_terminal_command , ")).toEqual(
      ["web_search", "run_terminal_command"],
    );
  });
});

describe("effectiveDisallowedTools + disableWebSearch coherence", () => {
  it("leaves list alone when disableWebSearch is off", () => {
    expect(effectiveDisallowedTools(["write"], false)).toEqual(["write"]);
    expect(effectiveDisallowedTools([], false)).toEqual([]);
  });

  it("injects web tools when disableWebSearch is on", () => {
    expect(effectiveDisallowedTools(["write"], true)).toEqual([
      "write",
      "web_search",
      "web_fetch",
    ]);
    expect(effectiveDisallowedTools([], true)).toEqual([
      "web_search",
      "web_fetch",
    ]);
  });

  it("does not duplicate web tools already present", () => {
    expect(
      effectiveDisallowedTools(["web_search", "web_fetch", "write"], true),
    ).toEqual(["web_search", "web_fetch", "write"]);
  });
});

describe("disallowedToolsCliValue / spawnArgs", () => {
  it("omits flag when empty", () => {
    expect(disallowedToolsCliValue([])).toBeNull();
    expect(disallowedToolsSpawnArgs([])).toEqual([]);
  });

  it("builds comma-separated CLI value", () => {
    expect(disallowedToolsCliValue(["web_search", "write"])).toBe(
      "web_search,write",
    );
    expect(disallowedToolsSpawnArgs(["web_search", "write"])).toEqual([
      "--disallowed-tools",
      "web_search,write",
    ]);
  });

  it("can merge disableWebSearch into spawn args", () => {
    expect(disallowedToolsCliValue(["write"], true)).toBe(
      "write,web_search,web_fetch",
    );
    expect(disallowedToolsSpawnArgs([], true)).toEqual([
      "--disallowed-tools",
      "web_search,web_fetch",
    ]);
  });
});

describe("toggle / membership", () => {
  it("toggles tools case-insensitively", () => {
    const a = toggleDisallowedTool([], "web_search");
    expect(a).toEqual(["web_search"]);
    expect(isToolDisallowed(a, "WEB_SEARCH")).toBe(true);
    const b = toggleDisallowedTool(a, "Web_Search");
    expect(b).toEqual([]);
  });

  it("preserves existing spelling when removing via different case", () => {
    expect(toggleDisallowedTool(["Agent", "write"], "agent")).toEqual([
      "write",
    ]);
  });
});

describe("disallowedToolsEqual", () => {
  it("compares order- and case-insensitively", () => {
    expect(disallowedToolsEqual(["a", "b"], ["B", "A"])).toBe(true);
    expect(disallowedToolsEqual(["a"], ["a", "b"])).toBe(false);
    expect(disallowedToolsEqual(null, [])).toBe(true);
  });
});

describe("catalog constants", () => {
  it("exposes common chips and web tools", () => {
    expect(WEB_SEARCH_TOOLS).toEqual(["web_search", "web_fetch"]);
    expect(COMMON_DISALLOWED_TOOLS.map((t) => t.id)).toContain(
      "run_terminal_command",
    );
    expect(
      COMMON_DISALLOWED_TOOLS.find((t) => t.id === "run_terminal_command")
        ?.caution,
    ).toBe(true);
    expect(isWebSearchTool("web_fetch")).toBe(true);
    expect(isWebSearchTool("write")).toBe(false);
  });
});
