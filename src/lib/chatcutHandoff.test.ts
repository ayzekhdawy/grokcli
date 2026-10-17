import { describe, expect, it } from "vitest";
import {
  applyChatcutLocalePath,
  chatcutHandoffToResourceOpenTarget,
  extractChatcutHandoffFields,
  isChatcutBillingUrl,
  isChatcutEditorUrl,
  resolveChatcutHandoff,
  resolveChatcutHandoffFromToolEvent,
  resolveChatcutLinkClick,
  resourceOpenTargetFromChatcutPayload,
  stripChatcutInternalParams,
} from "./chatcutHandoff";

const INTERNAL =
  "https://app.chatcut.io/editor/proj_abc?dockviewLayout=media&editor-boot-token=tok123";
const CLEAN = "https://app.chatcut.io/editor/proj_abc";
const BILLING = "https://app.chatcut.io/pricing";

describe("stripChatcutInternalParams", () => {
  it("removes dockviewLayout and editor-boot-token only", () => {
    const out = stripChatcutInternalParams(
      `${INTERNAL}&foo=bar`,
    );
    expect(out).toContain("foo=bar");
    expect(out).not.toContain("dockviewLayout");
    expect(out).not.toContain("editor-boot-token");
    expect(out).toContain("/editor/proj_abc");
  });
});

describe("applyChatcutLocalePath", () => {
  it("adds /zh for Chinese users", () => {
    expect(applyChatcutLocalePath(CLEAN, "zh")).toBe(
      "https://app.chatcut.io/zh/editor/proj_abc",
    );
  });
  it("adds /es for Spanish users", () => {
    expect(applyChatcutLocalePath(CLEAN, "es")).toBe(
      "https://app.chatcut.io/es/editor/proj_abc",
    );
  });
  it("strips locale for default English", () => {
    expect(
      applyChatcutLocalePath("https://app.chatcut.io/zh/editor/x", "en"),
    ).toBe("https://app.chatcut.io/editor/x");
  });
  it("preserves query and hash", () => {
    const u = applyChatcutLocalePath(
      "https://app.chatcut.io/editor/x?dockviewLayout=media#t=1",
      "zh",
    );
    expect(u).toContain("/zh/editor/x");
    expect(u).toContain("dockviewLayout=media");
    expect(u).toContain("#t=1");
  });
});

describe("billing vs editor classification", () => {
  it("classifies pricing as billing", () => {
    expect(isChatcutBillingUrl(BILLING)).toBe(true);
    expect(isChatcutEditorUrl(BILLING)).toBe(false);
  });
  it("classifies editor URLs", () => {
    expect(isChatcutEditorUrl(CLEAN)).toBe(true);
    expect(isChatcutEditorUrl(INTERNAL)).toBe(true);
    expect(isChatcutBillingUrl(CLEAN)).toBe(false);
  });
});

describe("resolveChatcutHandoff — shipped policy", () => {
  it("defaults editor handoff to system browser with clean URL", () => {
    const action = resolveChatcutHandoff(
      {
        editorUrl: CLEAN,
        browserHandoff: { required: true, url: INTERNAL },
        liveProject: {
          openStrategy: { preferredMode: "codex-internal-browser" },
        },
      },
      { locale: "en" },
    );
    expect(action.kind).toBe("open_external");
    if (action.kind !== "open_external") return;
    expect(action.reason).toBe("editor");
    expect(action.url).toContain("/editor/proj_abc");
    expect(action.url).not.toContain("dockviewLayout");
    expect(action.url).not.toContain("editor-boot-token");
  });

  it("falls back to editorUrl when browserHandoff.url missing", () => {
    const action = resolveChatcutHandoff({
      editorUrl: CLEAN,
      browserHandoff: { required: true },
    });
    expect(action.kind).toBe("open_external");
    if (action.kind !== "open_external") return;
    expect(action.reason).toBe("editor");
    expect(action.url).toContain("/editor/proj_abc");
  });

  it("opens system browser when preferredMode is codex-internal-browser", () => {
    const action = resolveChatcutHandoff({
      editorUrl: CLEAN,
      liveProject: {
        openStrategy: { preferredMode: "codex-internal-browser" },
      },
    });
    expect(action.kind).toBe("open_external");
    if (action.kind === "open_external") {
      expect(action.reason).toBe("editor");
    }
  });

  it("forceEditorInApp keeps EmbeddedBrowser path and internal params", () => {
    const action = resolveChatcutHandoff(
      {
        editorUrl: CLEAN,
        browserHandoff: { required: true, url: INTERNAL },
      },
      { forceEditorInApp: true },
    );
    expect(action.kind).toBe("open_in_app_browser");
    if (action.kind !== "open_in_app_browser") return;
    expect(action.url).toContain("dockviewLayout=media");
    expect(action.url).toContain("editor-boot-token=tok123");
    expect(action.displayUrl).not.toContain("dockviewLayout");
  });

  it("classifies billing as external", () => {
    const action = resolveChatcutHandoff({
      billingUrl: BILLING,
      editorUrl: CLEAN,
    });
    expect(action).toEqual({
      kind: "open_external",
      url: BILLING,
      reason: "billing",
    });
  });

  it("maps ResourceOpenTarget only when forceEditorInApp", () => {
    expect(
      resourceOpenTargetFromChatcutPayload({
        browserHandoff: { required: true, url: INTERNAL },
      }),
    ).toBeNull();
    const target = resourceOpenTargetFromChatcutPayload(
      { browserHandoff: { required: true, url: INTERNAL } },
      { forceEditorInApp: true },
    );
    expect(target).toEqual({
      type: "url",
      url: expect.stringContaining("dockviewLayout=media"),
      title: "ChatCut",
    });
    expect(chatcutHandoffToResourceOpenTarget({ kind: "none" })).toBeNull();
  });

  it("localizes system open URL for zh and strips internal params", () => {
    const action = resolveChatcutHandoff(
      { browserHandoff: { required: true, url: INTERNAL } },
      { locale: "zh-CN" },
    );
    expect(action.kind).toBe("open_external");
    if (action.kind !== "open_external") return;
    expect(action.url).toContain("/zh/editor/");
    expect(action.url).not.toContain("dockviewLayout");
  });

  it("parses structuredContent nesting and JSON strings", () => {
    const fields = extractChatcutHandoffFields({
      structuredContent: {
        browserHandoff: { required: true, url: INTERNAL },
        editorUrl: CLEAN,
      },
    });
    expect(fields.browserHandoffRequired).toBe(true);
    expect(fields.browserHandoffUrl).toBe(INTERNAL);
    expect(fields.editorUrl).toBe(CLEAN);

    const fromText = resolveChatcutHandoff(
      JSON.stringify({
        browserHandoff: { required: true, url: INTERNAL },
      }),
    );
    expect(fromText.kind).toBe("open_external");
    if (fromText.kind === "open_external") {
      expect(fromText.reason).toBe("editor");
    }
  });
});

describe("tool event + link click paths", () => {
  it("scans tool detail/path for handoff → system browser", () => {
    const action = resolveChatcutHandoffFromToolEvent({
      title: "chatcut__create_project",
      detail: JSON.stringify({
        browserHandoff: { required: true, url: INTERNAL },
        editorUrl: CLEAN,
      }),
      path: null,
    });
    expect(action.kind).toBe("open_external");
    if (action.kind !== "open_external") return;
    expect(action.reason).toBe("editor");
    expect(action.url).not.toContain("editor-boot-token");
    expect(action.url).toContain("/editor/proj_abc");
  });

  it("editor link click → system browser; billing → external", () => {
    const ed = resolveChatcutLinkClick(INTERNAL, { locale: "en" });
    expect(ed.kind).toBe("open_external");
    if (ed.kind === "open_external") {
      expect(ed.reason).toBe("editor");
      expect(ed.url).not.toContain("dockviewLayout");
    }
    const bill = resolveChatcutLinkClick(BILLING);
    expect(bill.kind).toBe("open_external");
    if (bill.kind === "open_external") {
      expect(bill.reason).toBe("billing");
    }
  });
});
