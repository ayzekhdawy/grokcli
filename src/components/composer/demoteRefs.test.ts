/**
 * 内置档的引用降级（ADR 0004）：引用段 → 附件条，单向有损。
 */
import { describe, expect, it } from "vitest";
import { demoteRefsForLegacyEditor, hasRefSegments } from "@/components/composer/demoteRefs";
import { refTokenText } from "@/lib/composerRefToken";

const FILE_TOKEN = refTokenText("file", "src/app/main.ts");
const DIR_TOKEN = refTokenText("dir", "src/hooks");
const URL_TOKEN = refTokenText("url", "https://example.com/a");

describe("hasRefSegments", () => {
  it("无 token 的草稿判 false", () => {
    expect(hasRefSegments("普通正文 @notAToken")).toBe(false);
  });

  it("含文件 token 判 true", () => {
    expect(hasRefSegments(`看 ${FILE_TOKEN} 这里`)).toBe(true);
  });

  it("含 url token 判 true", () => {
    expect(hasRefSegments(URL_TOKEN)).toBe(true);
  });
});

describe("demoteRefsForLegacyEditor", () => {
  it("无引用时原样返回，附件不动", () => {
    const result = demoteRefsForLegacyEditor("只有正文", [
      { path: "a.ts", name: "a.ts", isDir: false },
    ]);
    expect(result.text).toBe("只有正文");
    expect(result.attachments.map((a) => a.path)).toEqual(["a.ts"]);
    expect(result.converted).toBe(0);
  });

  it("文件与目录引用转成附件，正文只剩其余段落", () => {
    const result = demoteRefsForLegacyEditor(
      `前 ${FILE_TOKEN} 中 ${DIR_TOKEN} 后`,
    );
    expect(result.converted).toBe(2);
    expect(result.text).toBe("前  中  后");
    expect(result.attachments).toEqual([
      { path: "src/app/main.ts", name: "main.ts", isDir: false },
      { path: "src/hooks", name: "hooks", isDir: true },
    ]);
  });

  it("url 引用留在正文里，不进附件", () => {
    const result = demoteRefsForLegacyEditor(`见 ${URL_TOKEN}`);
    expect(result.converted).toBe(0);
    expect(result.text).toBe("见 https://example.com/a");
    expect(result.attachments).toEqual([]);
  });

  it("与既有附件按路径去重，且保留既有顺序", () => {
    const existing = [
      { path: "keep.ts", name: "keep.ts", isDir: false },
      { path: "src/app/main.ts", name: "旧名.ts", isDir: false },
    ];
    const result = demoteRefsForLegacyEditor(
      `x ${FILE_TOKEN}`,
      existing,
    );
    expect(result.attachments.map((a) => a.path)).toEqual([
      "keep.ts",
      "src/app/main.ts",
    ]);
    // mergeAttachments 语义：同路径以**新**条目为准（引用带的文件名覆盖旧的）。
    expect(result.attachments[1]?.name).toBe("main.ts");
    expect(result.converted).toBe(1);
  });
});
