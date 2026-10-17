/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  ALLOW_PAGE_DRAG_ATTR,
  dragStartShouldBeCancelled,
  installWindowsDragInputGuard,
} from "./windowsDragInputGuard";

describe("dragStartShouldBeCancelled", () => {
  it("cancels a text-node drag and an ordinary element drag", () => {
    const p = document.createElement("p");
    p.textContent = "hello";
    document.body.append(p);
    expect(dragStartShouldBeCancelled(p.firstChild)).toBe(true);
    expect(dragStartShouldBeCancelled(p)).toBe(true);
    p.remove();
  });

  it("lets an opted-in source drag", () => {
    const row = document.createElement("div");
    row.setAttribute(ALLOW_PAGE_DRAG_ATTR, "");
    const handle = document.createElement("span");
    row.append(handle);
    document.body.append(row);
    expect(dragStartShouldBeCancelled(handle)).toBe(false);
    expect(dragStartShouldBeCancelled(row)).toBe(false);
    row.remove();
  });
});

describe("installWindowsDragInputGuard", () => {
  it("does not listen outside Windows", () => {
    const stop = installWindowsDragInputGuard(document, "mac");
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it("cancels a page drag on Windows and leaves an opted-in drag alone", () => {
    const stop = installWindowsDragInputGuard(document, "win");
    const blocked = new Event("dragstart", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    const allowedHost = document.createElement("div");
    allowedHost.setAttribute(ALLOW_PAGE_DRAG_ATTR, "");
    document.body.append(allowedHost);
    const allowed = new Event("dragstart", { bubbles: true, cancelable: true });
    allowedHost.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
    allowedHost.remove();
    stop();

    const after = new Event("dragstart", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
