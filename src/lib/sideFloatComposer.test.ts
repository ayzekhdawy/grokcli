import { describe, expect, it } from "vitest";
import {
  isSideDockComposerActive,
  shouldHideChatForSideExpand,
} from "./sideFloatComposer";

describe("expand / dock flags", () => {
  it("hides chat only when expanded on desktop", () => {
    expect(
      shouldHideChatForSideExpand({ expanded: true, phoneLayout: false }),
    ).toBe(true);
    expect(
      shouldHideChatForSideExpand({ expanded: true, phoneLayout: true }),
    ).toBe(false);
    expect(
      shouldHideChatForSideExpand({ expanded: false, phoneLayout: false }),
    ).toBe(false);
  });

  it("activates dock only when expanded + dock toggle on desktop", () => {
    expect(
      isSideDockComposerActive({
        expanded: true,
        dockComposer: true,
        phoneLayout: false,
      }),
    ).toBe(true);
    expect(
      isSideDockComposerActive({
        expanded: true,
        dockComposer: false,
        phoneLayout: false,
      }),
    ).toBe(false);
    expect(
      isSideDockComposerActive({
        expanded: false,
        dockComposer: true,
        phoneLayout: false,
      }),
    ).toBe(false);
    expect(
      isSideDockComposerActive({
        expanded: true,
        dockComposer: true,
        phoneLayout: true,
      }),
    ).toBe(false);
  });
});
