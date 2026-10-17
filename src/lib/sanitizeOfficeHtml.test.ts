import { describe, expect, it } from "vitest";
import { sanitizeOfficeSheetHtml } from "./sanitizeOfficeHtml";

describe("sanitizeOfficeSheetHtml", () => {
  it("strips script tags and event handlers", () => {
    const dirty =
      '<table id="office-sheet"><tr><td onclick="alert(1)">x</td></tr></table><script>alert(2)</script>';
    const clean = sanitizeOfficeSheetHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).toMatch(/<table/i);
    expect(clean).toMatch(/>x</);
  });

  it("neutralizes javascript: hrefs", () => {
    const dirty = '<a href="javascript:alert(1)">y</a>';
    const clean = sanitizeOfficeSheetHtml(dirty);
    expect(clean.toLowerCase()).not.toContain("javascript:");
  });
});
