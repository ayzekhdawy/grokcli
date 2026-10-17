/**
 * `@` 落刀的两条档位分支（ADR 0004）。纯函数 + 注入的假依赖，覆盖：
 * 内置档删 token 进附件、Markdown 档插引用 chip、不可 token 化时回退附件。
 */
import { describe, expect, it, vi } from "vitest";
import { applyAtFileToComposer } from "@/lib/composerAtApply";
import type { Attachment } from "@/lib/attachments";

function ctx(over: Partial<Parameters<typeof applyAtFileToComposer>[0]> = {}) {
  const calls: string[] = [];
  const base = {
    entry: { path: "src/app/main.ts", name: "main.ts", isDir: false },
    kind: "legacy" as const,
    live: { present: true, start: 3, end: 5 },
    editorEl: () => null,
    clearAtState: vi.fn(),
    removeAtTokenFromDraft: vi.fn(
      (d: string, start: number, end: number) => {
        calls.push("remove-at-token");
        return `${d.slice(0, start)}${d.slice(end)}`;
      },
    ),
    setDraft: vi.fn((next: string | ((prev: string) => string)) => {
      calls.push("set-draft");
      return typeof next === "function" ? next("ab@qu") : next;
    }),
    setAttachments: vi.fn((next: (prev: Attachment[]) => Attachment[]) => {
      calls.push("set-attachments");
      return next([]);
    }),
    insertRefAtom: vi.fn(() => true),
    removeQueryRange: vi.fn(() => true),
    focus: vi.fn(),
  };
  return { ctx: { ...base, ...over }, calls };
}

describe("applyAtFileToComposer", () => {
  it("内置档：删掉 @query、文件进附件条，不碰编辑器 DOM", () => {
    const { ctx: c, calls } = ctx();
    applyAtFileToComposer(c);

    expect(c.clearAtState).toHaveBeenCalled();
    expect(calls).toEqual(["set-draft", "remove-at-token", "set-attachments"]);
    expect(c.setAttachments).toHaveBeenCalled();
    expect(c.insertRefAtom).not.toHaveBeenCalled();
    expect(c.focus).toHaveBeenCalled();
  });

  it("Markdown 档：把区间换成引用 chip（文档位置）", () => {
    const { ctx: c } = ctx({ kind: "tiptap" });
    applyAtFileToComposer(c);

    expect(c.insertRefAtom).toHaveBeenCalledWith(null, {
      from: 3,
      to: 5,
      kind: "file",
      value: "src/app/main.ts",
    });
    expect(c.setAttachments).not.toHaveBeenCalled();
  });

  it("Markdown 档：目录引用落成 dir 类型", () => {
    const { ctx: c } = ctx({
      kind: "tiptap",
      entry: { path: "src/hooks", name: "hooks", isDir: true },
    });
    applyAtFileToComposer(c);

    expect(c.insertRefAtom).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ kind: "dir" }),
    );
  });

  it("Markdown 档：路径不可 token 化时删区间并回退附件", () => {
    const { ctx: c } = ctx({
      kind: "tiptap",
      entry: { path: "bad\npath.ts", name: "bad.ts", isDir: false },
    });
    applyAtFileToComposer(c);

    expect(c.removeQueryRange).toHaveBeenCalledWith(null, { from: 3, to: 5 });
    expect(c.setAttachments).toHaveBeenCalled();
    expect(c.insertRefAtom).not.toHaveBeenCalled();
  });

  it("区间失效（live 为空）时不删不改，仍按档位落刀", () => {
    const { ctx: c } = ctx({ kind: "tiptap", live: { present: false, start: 0, end: 0 } });
    applyAtFileToComposer(c);

    expect(c.removeQueryRange).not.toHaveBeenCalled();
    expect(c.insertRefAtom).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ from: null, to: null }),
    );
  });
});
