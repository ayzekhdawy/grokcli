import { describe, expect, it } from "vitest";
import {
  PR_HUB_ANCHOR_ID,
  PR_HUB_SECTION,
  PR_HUB_TAB,
  buildPrHubDeepLink,
  hashPathOnly,
  isHighlightedPr,
  parseGithubPrNumber,
  parseHashQuery,
  parsePrHubDeepLink,
  sanitizePrNumber,
} from "./prHubDeepLink";

describe("hashPathOnly", () => {
  it("strips #, leading slash, query, trailing slash", () => {
    expect(hashPathOnly("#/settings/runtime/tools?pr=1")).toBe(
      "settings/runtime/tools",
    );
    expect(hashPathOnly("settings/runtime/tools/")).toBe(
      "settings/runtime/tools",
    );
    expect(hashPathOnly("")).toBe("");
  });
});

describe("parseHashQuery", () => {
  it("parses pr and ignores empty", () => {
    expect(parseHashQuery("#/settings/runtime/tools?pr=42")).toEqual({
      pr: "42",
    });
    expect(parseHashQuery("#/settings/runtime/tools")).toEqual({});
    expect(parseHashQuery("?pr=7&x=a%20b")).toEqual({ pr: "7", x: "a b" });
  });
});

describe("sanitizePrNumber", () => {
  it("accepts positive integers", () => {
    expect(sanitizePrNumber(42)).toBe(42);
    expect(sanitizePrNumber("99")).toBe(99);
    expect(sanitizePrNumber("#12")).toBe(12);
  });
  it("rejects junk", () => {
    expect(sanitizePrNumber(0)).toBeNull();
    expect(sanitizePrNumber(-1)).toBeNull();
    expect(sanitizePrNumber(3.5)).toBeNull();
    expect(sanitizePrNumber("nope")).toBeNull();
    expect(sanitizePrNumber("")).toBeNull();
    expect(sanitizePrNumber(null)).toBeNull();
  });
});

describe("parseGithubPrNumber", () => {
  it("reads GitHub PR URLs", () => {
    expect(
      parseGithubPrNumber("https://github.com/RongleCat/grok-app/pull/401"),
    ).toBe(401);
    expect(
      parseGithubPrNumber(
        "Creating pull request\nhttps://github.com/o/r/pull/7\n",
      ),
    ).toBe(7);
  });
  it("returns null without /pull/N", () => {
    expect(parseGithubPrNumber("https://github.com/o/r")).toBeNull();
    expect(parseGithubPrNumber("")).toBeNull();
  });
});

describe("buildPrHubDeepLink / parsePrHubDeepLink", () => {
  it("round-trips without PR", () => {
    const link = buildPrHubDeepLink();
    expect(link).toBe("#/settings/runtime/tools");
    expect(parsePrHubDeepLink(link)).toEqual({
      section: PR_HUB_SECTION,
      tab: PR_HUB_TAB,
      anchorId: PR_HUB_ANCHOR_ID,
      prNumber: null,
    });
  });
  it("round-trips with PR number", () => {
    const link = buildPrHubDeepLink({ prNumber: 42 });
    expect(link).toBe("#/settings/runtime/tools?pr=42");
    expect(parsePrHubDeepLink(link)).toEqual({
      section: "runtime",
      tab: "tools",
      anchorId: "settings-anchor-prHub",
      prNumber: 42,
    });
  });
  it("accepts prNumber alias in query", () => {
    expect(
      parsePrHubDeepLink("#/settings/runtime/tools?prNumber=9")?.prNumber,
    ).toBe(9);
  });
  it("rejects non-tools runtime tabs and other sections", () => {
    expect(parsePrHubDeepLink("#/settings/runtime/cli")).toBeNull();
    expect(parsePrHubDeepLink("#/settings/general/composer")).toBeNull();
    expect(parsePrHubDeepLink("#/settings/runtime")).toBeNull();
    expect(parsePrHubDeepLink("#/automations")).toBeNull();
  });
  it("ignores invalid pr query", () => {
    expect(
      parsePrHubDeepLink("#/settings/runtime/tools?pr=nope")?.prNumber,
    ).toBeNull();
  });
});

describe("isHighlightedPr", () => {
  it("matches only the requested number", () => {
    expect(isHighlightedPr(12, 12)).toBe(true);
    expect(isHighlightedPr(12, "12")).toBe(true);
    expect(isHighlightedPr(12, 13)).toBe(false);
    expect(isHighlightedPr(12, null)).toBe(false);
  });
});
