import { describe, expect, it } from "vitest";
import {
  dirForGitProbe,
  filterEditorsForGitContext,
  isGitGuiEditorId,
} from "./openApps";

describe("isGitGuiEditorId", () => {
  it("recognizes fork / sourcetree / github-desktop", () => {
    expect(isGitGuiEditorId("fork")).toBe(true);
    expect(isGitGuiEditorId("SourceTree")).toBe(true);
    expect(isGitGuiEditorId("github-desktop")).toBe(true);
    expect(isGitGuiEditorId("code")).toBe(false);
    expect(isGitGuiEditorId("terminal")).toBe(false);
  });
});

describe("filterEditorsForGitContext", () => {
  const editors = [
    { id: "code" },
    { id: "fork" },
    { id: "sourcetree" },
    { id: "github-desktop" },
    { id: "wt" },
  ];

  it("keeps git GUIs when repo", () => {
    expect(filterEditorsForGitContext(editors, true).map((e) => e.id)).toEqual(
      ["code", "fork", "sourcetree", "github-desktop", "wt"],
    );
  });

  it("drops git GUIs when not a repo", () => {
    expect(filterEditorsForGitContext(editors, false).map((e) => e.id)).toEqual(
      ["code", "wt"],
    );
  });
});

describe("dirForGitProbe", () => {
  it("returns dirs as-is and parents for files", () => {
    expect(dirForGitProbe("/Users/me/proj")).toBe("/Users/me/proj");
    expect(dirForGitProbe("/Users/me/proj/src/a.ts")).toBe(
      "/Users/me/proj/src",
    );
    expect(dirForGitProbe("C:\\repo\\README.md")).toBe("C:\\repo");
  });
});
