import { describe, expect, it } from "vitest";
import {
  PHONE_BREAKPOINT_PX,
  keyboardInsetBottom,
  phoneDrawerWidthPx,
} from "./phoneViewport";
import {
  MIRROR_DRAWER_BREAKPOINT,
  isMirrorPhoneLayout,
  isPhoneViewport,
} from "./layout";

describe("phone viewport helpers", () => {
  it("PHONE_BREAKPOINT_PX matches layout drawer breakpoint", () => {
    expect(PHONE_BREAKPOINT_PX).toBe(MIRROR_DRAWER_BREAKPOINT);
    expect(PHONE_BREAKPOINT_PX).toBe(820);
  });

  it("isPhoneViewport is true at and below 820, false above", () => {
    expect(isPhoneViewport(390)).toBe(true);
    expect(isPhoneViewport(820)).toBe(true);
    expect(isPhoneViewport(821)).toBe(false);
    expect(isPhoneViewport(1280)).toBe(false);
    expect(isPhoneViewport(Number.NaN)).toBe(false);
  });

  it("isMirrorPhoneLayout requires both mirror and phone width", () => {
    expect(
      isMirrorPhoneLayout({ isMirror: true, viewportWidth: 390 }),
    ).toBe(true);
    expect(
      isMirrorPhoneLayout({ isMirror: true, viewportWidth: 821 }),
    ).toBe(false);
    expect(
      isMirrorPhoneLayout({ isMirror: false, viewportWidth: 390 }),
    ).toBe(false);
  });

  it("keyboardInsetBottom is 0 when keyboard closed", () => {
    expect(
      keyboardInsetBottom({ height: 844, offsetTop: 0 }, 844),
    ).toBe(0);
  });

  it("keyboardInsetBottom reports keyboard height when viewport shrinks", () => {
    // 844 layout height, visual viewport 500, no scroll offset → 344
    expect(
      keyboardInsetBottom({ height: 500, offsetTop: 0 }, 844),
    ).toBe(344);
  });

  it("keyboardInsetBottom accounts for iOS visualViewport.offsetTop", () => {
    // Keyboard 300, page scrolled 40 → occupied = 844 - 544 - 40 = 260
    expect(
      keyboardInsetBottom({ height: 544, offsetTop: 40 }, 844),
    ).toBe(260);
  });

  it("keyboardInsetBottom never goes negative", () => {
    expect(
      keyboardInsetBottom({ height: 900, offsetTop: 0 }, 844),
    ).toBe(0);
  });

  it("keyboardInsetBottom tolerates missing visualViewport", () => {
    expect(keyboardInsetBottom(null, 844)).toBe(0);
    expect(keyboardInsetBottom(undefined, 844)).toBe(0);
  });

  it("phoneDrawerWidthPx is ~85% capped at 320", () => {
    // 0.85 * 390 ≈ 332 → still capped at 320
    expect(phoneDrawerWidthPx(390)).toBe(320);
    expect(phoneDrawerWidthPx(300)).toBe(Math.round(300 * 0.85));
    expect(phoneDrawerWidthPx(500)).toBe(320);
    expect(phoneDrawerWidthPx(0)).toBe(0);
  });
});
