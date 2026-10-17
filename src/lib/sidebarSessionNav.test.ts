import { describe, expect, it } from "vitest";
import { nextSessionId } from "./sidebarSessionNav";

const LIST = ["a", "b", "c"] as const;

describe("nextSessionId", () => {
  it("returns null for an empty list", () => {
    expect(nextSessionId([], "a", "next")).toBeNull();
    expect(nextSessionId([], null, "prev")).toBeNull();
  });

  it("moves next / prev within the list", () => {
    expect(nextSessionId(LIST, "a", "next")).toBe("b");
    expect(nextSessionId(LIST, "b", "next")).toBe("c");
    expect(nextSessionId(LIST, "c", "prev")).toBe("b");
    expect(nextSessionId(LIST, "b", "prev")).toBe("a");
  });

  it("clamps at the ends", () => {
    expect(nextSessionId(LIST, "c", "next")).toBe("c");
    expect(nextSessionId(LIST, "a", "prev")).toBe("a");
  });

  it("picks first on next / last on prev when current is missing", () => {
    expect(nextSessionId(LIST, null, "next")).toBe("a");
    expect(nextSessionId(LIST, undefined, "next")).toBe("a");
    expect(nextSessionId(LIST, "", "next")).toBe("a");
    expect(nextSessionId(LIST, "gone", "next")).toBe("a");
    expect(nextSessionId(LIST, null, "prev")).toBe("c");
    expect(nextSessionId(LIST, "gone", "prev")).toBe("c");
  });

  it("handles a single-item list", () => {
    expect(nextSessionId(["only"], "only", "next")).toBe("only");
    expect(nextSessionId(["only"], "only", "prev")).toBe("only");
    expect(nextSessionId(["only"], null, "next")).toBe("only");
    expect(nextSessionId(["only"], null, "prev")).toBe("only");
  });
});
