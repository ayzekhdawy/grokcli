/**
 * 内联引用 token 的语法约束。
 *
 * 这些不变量决定了 draft 能否无损往返：只要转义/解析不对称，引用就会在下次
 * 加载时退化成乱码文本，而那是静默的数据损坏。
 */
import { describe, expect, it } from "vitest";
import {
  escapeRefValue,
  isExternalHttpUrl,
  isTokenizableRefValue,
  matchPastedUrl,
  matchRefTokenAt,
  matchTypedUrl,
  stripTrailingUrlPunctuation,
  refAgentText,
  refDisplayLabel,
  refTokenText,
  unescapeRefValue,
  REF_TOKEN_RE,
} from "./composerRefToken";
import { parseStoredContentWithRefs } from "./draftDoc";

describe("ref token escaping", () => {
  it("leaves ordinary paths untouched so drafts stay readable", () => {
    // Arrange / Act / Assert
    expect(escapeRefValue("/repo/src/a b.ts")).toBe("/repo/src/a b.ts");
    expect(escapeRefValue("C:\\Users\\me\\a.ts")).toBe("C:\\Users\\me\\a.ts");
  });

  it("解转义只认大写序列，字面量 `%5d` / `%25` 原样保留", () => {
    // Arrange —— 转义只产出大写（`%5D` / `%25`）。解转义若带 `i` 标志，手写或旧版本
    // 留下的 `%5d` 会被解成 `]`、`%25` 之外的小写 `%25`…都会静默改掉路径。
    // Act / Assert
    expect(unescapeRefValue("/repo/a%5db.ts")).toBe("/repo/a%5db.ts");
    expect(unescapeRefValue("/repo/a%5Db.ts")).toBe("/repo/a]b.ts");
    expect(unescapeRefValue("/repo/100%25.ts")).toBe("/repo/100%.ts");
    // token 解析同理：小写序列不是转义
    expect(parseStoredContentWithRefs("[[file:/repo/a%5db.ts]]")).toEqual([
      { type: "ref", kind: "file", value: "/repo/a%5db.ts" },
    ]);
  });

  it("escapes only the two characters that break the grammar", () => {
    // Arrange / Act / Assert — `]` 会提前闭合 token，`%` 是转义符本身
    expect(escapeRefValue("/repo/a]b.ts")).toBe("/repo/a%5Db.ts");
    expect(escapeRefValue("/repo/100%.ts")).toBe("/repo/100%25.ts");
    expect(unescapeRefValue("/repo/100%25.ts")).toBe("/repo/100%.ts");
  });

  it("round-trips every escaped value", () => {
    // Arrange
    const cases = [
      "/repo/a.ts",
      "/repo/my dir/a b.ts",
      "/repo/a]b.ts",
      "/repo/50% off/a].ts",
      "https://example.com/a?b=1&c=2",
    ];

    // Act / Assert
    for (const value of cases) {
      expect(unescapeRefValue(escapeRefValue(value))).toBe(value);
    }
  });

  it("refuses values that cannot live inside an inline token", () => {
    // Arrange / Act / Assert — 换行会跨段落，写进 token 就再也解析不回来
    expect(isTokenizableRefValue("/repo/a.ts")).toBe(true);
    expect(isTokenizableRefValue("")).toBe(false);
    expect(isTokenizableRefValue("/repo/a\nb.ts")).toBe(false);
  });
});

describe("ref token text", () => {
  it("builds one token per kind", () => {
    expect(refTokenText("file", "/a.ts")).toBe("[[file:/a.ts]]");
    expect(refTokenText("dir", "/a")).toBe("[[dir:/a]]");
    expect(refTokenText("url", "https://x.y")).toBe("[[url:https://x.y]]");
  });

  it("parses back exactly what it wrote", () => {
    // Arrange
    const cases: Array<["file" | "dir" | "url", string]> = [
      ["file", "/repo/a b.ts"],
      ["file", "/repo/a]b.ts"],
      ["dir", "/repo/src"],
      ["url", "https://example.com/x?y=1"],
    ];

    // Act / Assert
    for (const [kind, value] of cases) {
      const text = refTokenText(kind, value);
      expect(matchRefTokenAt(text, 0)).toEqual({
        kind,
        value,
        length: text.length,
      });
    }
  });

  it("matches a token only at the requested position", () => {
    // Arrange
    const text = "before [[file:/a.ts]] after";

    // Act / Assert
    expect(matchRefTokenAt(text, 0)).toBeNull();
    expect(matchRefTokenAt(text, 7)).toEqual({
      kind: "file",
      value: "/a.ts",
      length: "[[file:/a.ts]]".length,
    });
  });

  it("does not match malformed or unknown-kind tokens", () => {
    // Arrange / Act / Assert
    expect(matchRefTokenAt("[[file:/a.ts", 0)).toBeNull();
    expect(matchRefTokenAt("[[thing:/a.ts]]", 0)).toBeNull();
    expect(matchRefTokenAt("[[skill:review]]", 0)).toBeNull();
  });

  it("keeps the global regex usable across calls", () => {
    // Arrange — 共享的 `g` 正则若 lastIndex 未被规则重置，第二次匹配会失败
    const text = "[[file:/a.ts]] [[dir:/b]]";

    // Act
    const first = REF_TOKEN_RE.exec(text);
    const second = REF_TOKEN_RE.exec(text);

    // Assert
    expect(first?.[1]).toBe("file");
    expect(second?.[1]).toBe("dir");
  });
});

describe("ref agent form and label", () => {
  it("sends files and dirs with the CLI @ syntax, URLs as-is", () => {
    // Arrange / Act / Assert — 与 buildAgentPrompt 的附件写法一致，CLI 无需改动
    expect(refAgentText("file", "/a.ts")).toBe("@/a.ts");
    expect(refAgentText("dir", "/a")).toBe("@/a");
    expect(refAgentText("url", "https://x.y/z")).toBe("https://x.y/z");
  });

  it("labels an inline chip with the trailing name", () => {
    // Arrange / Act / Assert
    expect(refDisplayLabel("file", "/repo/src/a.ts")).toBe("a.ts");
    expect(refDisplayLabel("dir", "/repo/src/components")).toBe("components");
    expect(refDisplayLabel("dir", "/repo/src/")).toBe("src");
    // URL 显示「主机 + 路径」：只留主机名几乎等于没信息，带上 query/hash 又太宽。
    expect(refDisplayLabel("url", "https://example.com/a/b")).toBe(
      "example.com/a/b",
    );
    expect(
      refDisplayLabel("url", "https://github.com/RongleCat/grok-app/#/test"),
    ).toBe("github.com/RongleCat/grok-app");
    expect(refDisplayLabel("url", "https://x.y/a?b=1#c")).toBe("x.y/a");
    expect(refDisplayLabel("url", "https://x.y/")).toBe("x.y");
    expect(refDisplayLabel("url", "https://x.y")).toBe("x.y");
  });
});

// ── URL 自动识别 ───────────────────────────────────────────────────

describe("url scheme gate", () => {
  it("accepts only absolute http(s)", () => {
    // Arrange / Act / Assert
    expect(isExternalHttpUrl("https://example.com/a")).toBe(true);
    expect(isExternalHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects every non-http scheme and origin-relative form", () => {
    // Arrange / Act / Assert — chip 与可点击链接共用这一条判定
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>x</script>",
      "blob:https://example.com/abc",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "mailto:a@b.c",
      "//example.com/x",
      "/repo/src/a.ts",
      "#fragment",
      "example.com",
      "",
    ]) {
      expect(isExternalHttpUrl(bad)).toBe(false);
    }
  });
});

describe("stripTrailingUrlPunctuation", () => {
  it("drops sentence punctuation in both scripts", () => {
    // Arrange / Act / Assert
    expect(stripTrailingUrlPunctuation("https://x.y/z.")).toBe("https://x.y/z");
    expect(stripTrailingUrlPunctuation("https://x.y/z,")).toBe("https://x.y/z");
    expect(stripTrailingUrlPunctuation("https://x.y/z。")).toBe("https://x.y/z");
    expect(stripTrailingUrlPunctuation("https://x.y/z！？")).toBe("https://x.y/z");
    expect(stripTrailingUrlPunctuation("https://x.y/z…")).toBe("https://x.y/z");
  });

  it("keeps a closing paren that belongs to the URL", () => {
    // Arrange — 维基类链接的 `(bar)` 是路径的一部分，剥掉会截断
    const url = "https://en.wikipedia.org/wiki/Foo_(bar)";

    // Act / Assert
    expect(stripTrailingUrlPunctuation(url)).toBe(url);
    expect(stripTrailingUrlPunctuation(`${url}.`)).toBe(url);
  });

  it("drops a trailing paren that is sentence punctuation", () => {
    // Arrange — 句子的 `)` 不配对，属于正文
    expect(stripTrailingUrlPunctuation("https://x.y/z)")).toBe("https://x.y/z");
  });

  it("drops a wrapping paren only on the trailing side", () => {
    // Arrange — 句首的 `(` 不归本函数管；因此 `(https://x.y)` 不是「整段即链接」，
    // 调用方会因它不以 http 开头而拒绝转换（不会产生错误 chip）。
    expect(stripTrailingUrlPunctuation("(https://x.y)")).toBe("(https://x.y)");
    expect(matchPastedUrl("(https://x.y)")).toBeNull();
  });
});

describe("matchPastedUrl", () => {
  it("accepts a clipboard that is exactly one link", () => {
    // Arrange / Act / Assert
    expect(matchPastedUrl("https://example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(matchPastedUrl("  https://example.com/a\n")).toBe(
      "https://example.com/a",
    );
    expect(matchPastedUrl("https://example.com/a。")).toBe(
      "https://example.com/a",
    );
  });

  it("refuses anything that is not a single bare link", () => {
    // Arrange / Act / Assert — 含空白或不是 http(s) 的粘贴照旧走 Markdown
    expect(matchPastedUrl("see https://example.com")).toBeNull();
    expect(matchPastedUrl("https://a.b\nhttps://c.d")).toBeNull();
    expect(matchPastedUrl("plain text")).toBeNull();
    expect(matchPastedUrl("javascript:alert(1)")).toBeNull();
    expect(matchPastedUrl("")).toBeNull();
  });
});

describe("matchTypedUrl", () => {
  it("converts a link the user just typed at end of a word boundary", () => {
    // Arrange / Act / Assert
    expect(matchTypedUrl("https://x.y ")).toEqual({
      url: "https://x.y",
      start: 0,
    });
    expect(matchTypedUrl("看 https://x.y ")).toEqual({
      url: "https://x.y",
      start: 2,
    });
  });

  it("does not fire mid-word or without a trailing space", () => {
    // Arrange / Act / Assert — `xhttps://y` 里的片段不是链接
    expect(matchTypedUrl("xhttps://x.y ")).toBeNull();
    expect(matchTypedUrl("https://x.y")).toBeNull();
  });

  it("points start at the stripped url, not the raw token", () => {
    // Arrange / Act
    const hit = matchTypedUrl("看 https://x.y/z。 ");

    // Assert — 句读不属于链接，替换区间必须只覆盖 URL 本身
    expect(hit).toEqual({ url: "https://x.y/z", start: 2 });
  });
});
