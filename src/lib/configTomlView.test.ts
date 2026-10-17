import { describe, expect, it } from "vitest";
import {
  extractTomlSections,
  redactConfigToml,
  sectionAnchorId,
} from "./configTomlView";

const SAMPLE = `
# comment
[models]
default = "grok"

[model.relay]
name = "relay"
base_url = "https://example.com/v1"
api_key = "sk-abcdefghijklmnopqrstuvwxyz012345"
secret = "deploy-secret-should-never-show"
token = "supersecrettokenvalue123"
deployment_key = "dep_abcdefghijklmnopqr"
client_secret = "client-secret-value"
authorization = "Bearer supersecrettokenvalue"

[[plugins]]
name = "a"

[ui]
theme = "dark"
`;

describe("redactConfigToml", () => {
  it("redacts secret assignments and token prefixes", () => {
    const out = redactConfigToml(SAMPLE);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(out).not.toContain("deploy-secret-should-never-show");
    expect(out).not.toContain("supersecrettokenvalue123");
    expect(out).not.toContain("dep_abcdefghijklmnopqr");
    expect(out).not.toContain("client-secret-value");
    expect(out).not.toContain("supersecrettokenvalue");
    // Non-secret fields preserved
    expect(out).toContain('base_url = "https://example.com/v1"');
    expect(out).toContain('theme = "dark"');
    expect(out).toContain("[models]");
  });

  it("redacts bare token prefixes in free text", () => {
    const out = redactConfigToml('note = "see sk-abcdefghijklmnopqrstuvwxyz0123"');
    expect(out).toMatch(/sk-\[REDACTED\]|\[REDACTED\]/);
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
  });

  it("handles empty / null", () => {
    expect(redactConfigToml("")).toBe("");
    expect(redactConfigToml(null)).toBe("");
    expect(redactConfigToml(undefined)).toBe("");
  });

  it("preserves trailing newline", () => {
    expect(redactConfigToml("a = 1\n").endsWith("\n")).toBe(true);
  });
});

describe("extractTomlSections", () => {
  it("lists table headers with line numbers", () => {
    const secs = extractTomlSections(SAMPLE);
    expect(secs.map((s) => s.name)).toEqual([
      "[models]",
      "[model.relay]",
      "[[plugins]]",
      "[ui]",
    ]);
    expect(secs[0]!.line).toBeGreaterThanOrEqual(0);
    expect(secs[1]!.line).toBeGreaterThan(secs[0]!.line);
  });

  it("returns empty for blank input", () => {
    expect(extractTomlSections("")).toEqual([]);
    expect(extractTomlSections(null)).toEqual([]);
  });
});

describe("sectionAnchorId", () => {
  it("is DOM-safe and stable", () => {
    const id = sectionAnchorId("[model.relay]", 12);
    expect(id).toMatch(/^cfg-toml-sec-12-/);
    expect(id).not.toMatch(/[\[\]]/);
  });
});
