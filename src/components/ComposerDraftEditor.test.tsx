/**
 * @vitest-environment jsdom
 *
 * 档位降级（ADR 0004）：切到内置档时，草稿里的行内引用段必须在**交给编辑器之前**
 * 被摘掉并转成附件条 —— 内置编辑器读不了引用段。Markdown 档则原样保留。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import { cleanup, render } from "@testing-library/react";
import { ComposerDraftEditor } from "@/components/ComposerDraftEditor";
import { setComposerEditorKind } from "@/components/composer/editorPref";
import { getDraft, setDraft } from "@/lib/composerDraftStore";
import { refTokenText } from "@/lib/composerRefToken";

const FILE_TOKEN = refTokenText("file", "src/app/main.ts");

beforeEach(() => {
  setComposerEditorKind("legacy");
  setDraft("");
});

afterEach(() => {
  cleanup();
  setDraft("");
  setComposerEditorKind(undefined);
});

describe("ComposerDraftEditor 的档位降级", () => {
  it("内置档：引用段不进编辑器，草稿落盘为降级后的正文，引用转成附件", () => {
    setDraft(`看 ${FILE_TOKEN} 这里`);
    const onDemoteRefs = vi.fn();
    const { container } = render(
      <ComposerDraftEditor onDemoteRefs={onDemoteRefs} aria-label="t" />,
    );

    expect(container.textContent ?? "").not.toContain("[[file:");
    expect(onDemoteRefs).toHaveBeenCalledWith([
      { path: "src/app/main.ts", name: "main.ts", isDir: false },
    ]);
    expect(getDraft()).toBe("看  这里");
  });

  it("Markdown 档：引用段原样交给编辑器，不做降级", () => {
    setComposerEditorKind("tiptap");
    setDraft(`看 ${FILE_TOKEN} 这里`);
    const onDemoteRefs = vi.fn();
    render(<ComposerDraftEditor onDemoteRefs={onDemoteRefs} aria-label="t" />);

    expect(onDemoteRefs).not.toHaveBeenCalled();
    expect(getDraft()).toBe(`看 ${FILE_TOKEN} 这里`);
  });
});
