import { describe, expect, it } from "vitest";
import {
  PROJECT_COLOR_TOKENS,
  PROJECT_COLOR_TOKEN_CSS,
  isProjectColorToken,
  normalizeHexColor,
  normalizeProjectColor,
  resolveProjectColorCss,
} from "./projectColor";

describe("normalizeProjectColor", () => {
  it("accepts known tokens (case / trim)", () => {
    for (const tok of PROJECT_COLOR_TOKENS) {
      expect(normalizeProjectColor(tok)).toBe(tok);
      expect(normalizeProjectColor(`  ${tok.toUpperCase()}  `)).toBe(tok);
    }
  });

  it("accepts #rgb and #rrggbb hex (lowercased)", () => {
    expect(normalizeProjectColor("#ABC")).toBe("#abc");
    expect(normalizeProjectColor("#a1B2c3")).toBe("#a1b2c3");
    expect(normalizeProjectColor("  #FfEeDd  ")).toBe("#ffeedd");
    expect(normalizeProjectColor("#000")).toBe("#000");
    expect(normalizeProjectColor("#ffffff")).toBe("#ffffff");
  });

  it("treats empty / clear tokens as null", () => {
    expect(normalizeProjectColor(null)).toBeNull();
    expect(normalizeProjectColor(undefined)).toBeNull();
    expect(normalizeProjectColor("")).toBeNull();
    expect(normalizeProjectColor("   ")).toBeNull();
    expect(normalizeProjectColor("none")).toBeNull();
    expect(normalizeProjectColor("NONE")).toBeNull();
    expect(normalizeProjectColor("inherit")).toBeNull();
    expect(normalizeProjectColor("default")).toBeNull();
    expect(normalizeProjectColor("clear")).toBeNull();
    expect(normalizeProjectColor("null")).toBeNull();
    expect(normalizeProjectColor(42)).toBeNull();
    expect(normalizeProjectColor(true)).toBeNull();
  });

  it("rejects unknown tokens and invalid hex", () => {
    expect(normalizeProjectColor("red")).toBeNull();
    expect(normalizeProjectColor("yellow")).toBeNull();
    expect(normalizeProjectColor("#gg0000")).toBeNull();
    expect(normalizeProjectColor("#12")).toBeNull();
    expect(normalizeProjectColor("#12345")).toBeNull();
    expect(normalizeProjectColor("#1234567")).toBeNull();
    expect(normalizeProjectColor("a1b2c3")).toBeNull(); // missing #
    expect(normalizeProjectColor("blueish")).toBeNull();
  });
});

describe("normalizeHexColor", () => {
  it("requires leading # and 3 or 6 hex digits", () => {
    expect(normalizeHexColor("#abc")).toBe("#abc");
    expect(normalizeHexColor("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHexColor("abc")).toBeNull();
    expect(normalizeHexColor("#abcd")).toBeNull();
  });
});

describe("isProjectColorToken", () => {
  it("true only for named tokens", () => {
    expect(isProjectColorToken("blue")).toBe(true);
    expect(isProjectColorToken("  GREEN  ")).toBe(true);
    expect(isProjectColorToken("#abc")).toBe(false);
    expect(isProjectColorToken("none")).toBe(false);
    expect(isProjectColorToken(null)).toBe(false);
  });
});

describe("resolveProjectColorCss", () => {
  it("maps tokens to CSS and passes hex through", () => {
    expect(resolveProjectColorCss("blue")).toBe(PROJECT_COLOR_TOKEN_CSS.blue);
    expect(resolveProjectColorCss("pink")).toBe(PROJECT_COLOR_TOKEN_CSS.pink);
    expect(resolveProjectColorCss("#a1b2c3")).toBe("#a1b2c3");
    expect(resolveProjectColorCss("#ABC")).toBe("#abc");
    expect(resolveProjectColorCss(null)).toBeNull();
    expect(resolveProjectColorCss("none")).toBeNull();
    expect(resolveProjectColorCss("nope")).toBeNull();
  });
});
