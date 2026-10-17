/**
 * 引用 segment 在 draft 模型里的行为。
 *
 * 重点是无损与「说到哪就是哪」：引用必须留在正文中说到的位置，而不是像
 * skill 那样被提到最前；漏改 `serializeForAgent` 会把 `[[file:…]]` 字面
 * 发给 CLI。
 */
import { describe, expect, it } from "vitest";
import {
  editableTextOf,
  isDraftEmpty,
  parseStoredContent,
  parseStoredContentWithRefs,
  previewStoredAsSlash,
  serializeForAgent,
  segmentsFromEditedText,
  serializeStored,
  type AnyDraftSegment,
} from "./draftDoc";

describe("parseStoredContentWithRefs with references", () => {
  it("splits a sentence around an inline reference", () => {
    // Arrange
    const stored = "在 [[file:/repo/src/a.ts]] 中找到 xxx 逻辑";

    // Act
    const segs = parseStoredContentWithRefs(stored);

    // Assert
    expect(segs).toEqual([
      { type: "text", text: "在 " },
      { type: "ref", kind: "file", value: "/repo/src/a.ts" },
      { type: "text", text: " 中找到 xxx 逻辑" },
    ]);
  });

  it("restores escaped values and keeps kinds apart", () => {
    // Arrange — 路径里的 `]` 必须以 `%5D` 存储，否则会提前闭合 token
    const stored = "[[dir:/repo/a%5Db]] [[url:https://x.y/z]]";

    // Act
    const segs = parseStoredContentWithRefs(stored);

    // Assert
    expect(segs).toEqual([
      { type: "ref", kind: "dir", value: "/repo/a]b" },
      { type: "text", text: " " },
      { type: "ref", kind: "url", value: "https://x.y/z" },
    ]);
  });

  it("keeps a malformed token as text", () => {
    // Arrange — 未闭合的 token 不是引用，不能凭空造出一个 segment
    const stored = "[[file:/repo/a.ts";

    // Act / Assert
    expect(parseStoredContentWithRefs(stored)).toEqual([
      { type: "text", text: stored },
    ]);
  });

  it("round-trips through serializeStored", () => {
    // Arrange
    const stored = "看 [[file:/repo/my dir/a b.ts]] 和 [[dir:/repo/src]] 与 [[skill:review]]";

    // Act / Assert
    expect(serializeStored(parseStoredContentWithRefs(stored))).toBe(stored);
  });
});

describe("serializeForAgent with references", () => {
  it("sends a reference in place as the CLI @ form", () => {
    // Arrange
    const segs = parseStoredContentWithRefs("在 [[file:/repo/a.ts]] 中找到 xxx 逻辑");

    // Act
    const out = serializeForAgent(segs);

    // Assert
    expect(out).toBe("在 @/repo/a.ts 中找到 xxx 逻辑");
  });

  it("keeps the reference inline while skills still hoist to the front", () => {
    // Arrange — skill 提到最前是既有行为；引用不能被一起提走，否则句子会散
    const segs = parseStoredContentWithRefs("[[skill:review]] 看 [[file:/repo/a.ts]] 这里的逻辑");

    // Act
    const out = serializeForAgent(segs);

    // Assert
    expect(out).toBe("/review\n看 @/repo/a.ts 这里的逻辑");
  });

  it("sends a URL reference as the URL itself", () => {
    // Arrange / Act
    const out = serializeForAgent(
      parseStoredContentWithRefs("see [[url:https://x.y/z]]"),
    );

    // Assert
    expect(out).toBe("see https://x.y/z");
  });

  it("sends a lone reference without surrounding text", () => {
    // Arrange / Act / Assert
    expect(serializeForAgent(parseStoredContentWithRefs("[[dir:/repo/src]]"))).toBe(
      "@/repo/src",
    );
  });
});

describe("draft emptiness and previews with references", () => {
  it("treats a reference-only draft as sendable", () => {
    // Arrange / Act / Assert
    expect(isDraftEmpty(parseStoredContentWithRefs("[[file:/a.ts]]"))).toBe(false);
    expect(isDraftEmpty(parseStoredContentWithRefs("[[dir:/a]]"))).toBe(false);
    expect(isDraftEmpty(parseStoredContentWithRefs("  \n "))).toBe(true);
  });

  it("never leaks a raw token into one-line previews", () => {
    // Arrange / Act / Assert
    expect(previewStoredAsSlash("看 [[file:/repo/a.ts]] 这里")).toBe(
      "看 @/repo/a.ts 这里",
    );
    expect(previewStoredAsSlash("[[dir:/repo/src]]")).toBe("@/repo/src");
  });
});

describe("editableTextOf / segmentsFromEditedText（行内编辑用户消息）", () => {
  it("正文里保留引用的 agent 形态且位置不变", () => {
    // Arrange
    const segs = parseStoredContentWithRefs("在 [[file:/repo/src/a.ts]] 中找到 xxx");

    // Act
    const text = editableTextOf(segs);

    // Assert
    expect(text).toBe("在 @/repo/src/a.ts 中找到 xxx");
  });

  it("编辑后原样认回引用，位置不挪", () => {
    // Arrange
    const segs = parseStoredContentWithRefs("在 [[file:/repo/src/a.ts]] 中找到 xxx");
    const refs = segs.filter((s) => s.type === "ref");

    // Act — 用户只改了尾部措辞
    const rebuilt = segmentsFromEditedText("在 @/repo/src/a.ts 中找到 yyy", refs);

    // Assert
    expect(rebuilt).toEqual([
      { type: "text", text: "在 " },
      { type: "ref", kind: "file", value: "/repo/src/a.ts" },
      { type: "text", text: " 中找到 yyy" },
    ]);
    expect(serializeStored(rebuilt)).toBe(
      "在 [[file:/repo/src/a.ts]] 中找到 yyy",
    );
  });

  it("用户删掉引用文本后不再造出引用段", () => {
    // Arrange
    const refs = parseStoredContentWithRefs("[[url:https://x.y/z]] 看这个").filter(
      (s) => s.type === "ref",
    );

    // Act
    const rebuilt = segmentsFromEditedText("看这个", refs);

    // Assert
    expect(rebuilt).toEqual([{ type: "text", text: "看这个" }]);
  });

  it("用户改写过的路径按普通文本留下，不猜成引用", () => {
    // Arrange
    const refs = parseStoredContentWithRefs("[[file:/repo/a.ts]] 里").filter(
      (s) => s.type === "ref",
    );
    const edited = "@/repo/other.ts 里";

    // Act
    const rebuilt = segmentsFromEditedText(edited, refs);

    // Assert
    expect(rebuilt).toEqual([{ type: "text", text: edited }]);
  });

  it("随手写的 @文本 不会被当成引用（验收 C9）", () => {
    // Arrange
    const refs = parseStoredContentWithRefs("[[file:/repo/a.ts]] 里").filter(
      (s) => s.type === "ref",
    );

    // Act
    const rebuilt = segmentsFromEditedText(
      "@/repo/a.ts 里 @某人 和 @/goal",
      refs,
    );

    // Assert
    expect(rebuilt).toEqual([
      { type: "ref", kind: "file", value: "/repo/a.ts" },
      { type: "text", text: " 里 @某人 和 @/goal" },
    ]);
  });

  it("多个引用按原顺序认回", () => {
    // Arrange
    const refs = parseStoredContentWithRefs(
      "[[file:/a.ts]] 和 [[dir:/repo/src]] 都看",
    ).filter((s) => s.type === "ref");

    // Act
    const rebuilt = segmentsFromEditedText(
      "@/a.ts 和 /repo/src 都看",
      refs,
    );

    // Assert — 目录引用被用户删掉了（agent 形态是 @/repo/src，正文里不是），
    // 于是只剩文件引用 + 普通文本。
    expect(rebuilt).toEqual([
      { type: "ref", kind: "file", value: "/a.ts" },
      { type: "text", text: " 和 /repo/src 都看" },
    ]);
  });
});

describe("parseStoredContentWithRefs 的协议校验（验收 C11）", () => {
  it("非 http(s) 的 url token 恢复成普通文本，不造可点语义的 chip", () => {
    // Arrange
    const stored = "点 [[url:javascript:alert(1)]] 试试";

    // Act
    const segs = parseStoredContentWithRefs(stored);

    // Assert
    expect(segs).toEqual([
      { type: "text", text: "点 " },
      { type: "text", text: "[[url:javascript:alert(1)]]" },
      { type: "text", text: " 试试" },
    ]);
  });

  it("http(s) 的 url token 仍然是引用", () => {
    // Arrange / Act
    const segs = parseStoredContentWithRefs("[[url:https://x.y/z]]");

    // Assert
    expect(segs).toEqual([{ type: "ref", kind: "url", value: "https://x.y/z" }]);
  });

  it("file / dir token 不受 url 协议校验影响", () => {
    // Arrange / Act — 本地路径不是 URL，不该被 http 规则波及
    const segs = parseStoredContentWithRefs("[[file:/repo/a.ts]]");

    // Assert
    expect(segs).toEqual([
      { type: "ref", kind: "file", value: "/repo/a.ts" },
    ]);
  });
});

describe("基版本 API 与上游旧编辑器的契约", () => {
  it("`parseStoredContent`（上游签名）把引用段降级为纯文本，不产出 ref 段", () => {
    // 上游那份 composer 编辑器遍历段落时假定 `seg.text` 一定存在，
    // 因此基版本必须把引用降级，ref 段只经 `*WithRefs` 系列出现。
    // 基版本签名返回 DraftSegment[]；显式升宽到 AnyDraftSegment[] 才能断言「不含 ref 段」。
    const segs: AnyDraftSegment[] = parseStoredContent("在 [[file:/repo/a.ts]] 里");
    expect(segs.some((s) => s.type === "ref")).toBe(false);
    expect(segs).toEqual([
      { type: "text", text: "在 " },
      { type: "text", text: "[[file:/repo/a.ts]]" },
      { type: "text", text: " 里" },
    ]);
  });

  it("`*WithRefs` 版本保留 ref 段", () => {
    const segs = parseStoredContentWithRefs("在 [[file:/repo/a.ts]] 里");
    expect(segs).toEqual([
      { type: "text", text: "在 " },
      { type: "ref", kind: "file", value: "/repo/a.ts" },
      { type: "text", text: " 里" },
    ]);
  });
});
