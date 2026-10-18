/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  anchoredScrollTop,
  findDisclosureToggle,
} from "./disclosureScrollAnchor";

describe("findDisclosureToggle", () => {
  const build = () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="row">
        <button aria-expanded="false" id="t"><span id="inner">Web'de arandı</span></button>
        <button id="copy">copy</button>
        <a href="#" id="link">x</a>
      </div>`;
    document.body.appendChild(root);
    return root;
  };

  it("resolves a click inside a chevron button to that button", () => {
    const root = build();
    expect(findDisclosureToggle(root.querySelector("#inner"), root)?.id).toBe(
      "t",
    );
  });

  it("ignores non-disclosure clicks", () => {
    const root = build();
    expect(findDisclosureToggle(root.querySelector("#copy"), root)).toBeNull();
    expect(findDisclosureToggle(root.querySelector("#link"), root)).toBeNull();
    expect(findDisclosureToggle(null, root)).toBeNull();
  });

  it("ignores toggles outside the scroller", () => {
    const root = build();
    const outside = document.createElement("button");
    outside.setAttribute("aria-expanded", "true");
    document.body.appendChild(outside);
    expect(findDisclosureToggle(outside, root)).toBeNull();
  });
});

describe("anchoredScrollTop", () => {
  it("keeps the header put when content above it grows", () => {
    expect(
      anchoredScrollTop({
        scrollTop: 1000,
        anchorTopAtClick: 200,
        anchorTopNow: 320,
        maxScrollTop: 5000,
      }),
    ).toBe(1120);
  });

  it("undoes a snap-to-bottom that moved the header up", () => {
    expect(
      anchoredScrollTop({
        scrollTop: 1400,
        anchorTopAtClick: 300,
        anchorTopNow: -100,
        maxScrollTop: 5000,
      }),
    ).toBe(1000);
  });

  it("is a no-op for sub-pixel drift", () => {
    expect(
      anchoredScrollTop({
        scrollTop: 50,
        anchorTopAtClick: 10,
        anchorTopNow: 10.3,
        maxScrollTop: 100,
      }),
    ).toBe(50);
  });

  it("clamps to the scroll range", () => {
    expect(
      anchoredScrollTop({
        scrollTop: 90,
        anchorTopAtClick: 0,
        anchorTopNow: 500,
        maxScrollTop: 100,
      }),
    ).toBe(100);
    expect(
      anchoredScrollTop({
        scrollTop: 10,
        anchorTopAtClick: 400,
        anchorTopNow: 0,
        maxScrollTop: 100,
      }),
    ).toBe(0);
  });
});
