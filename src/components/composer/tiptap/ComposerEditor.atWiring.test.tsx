/**
 * @vitest-environment jsdom
 *
 * 接线回归（ADR 0003 第 1 步）：`ComposerEditor` 的 `@` 区间上报 → 命令式插入。
 *
 * 删掉旧的 `ComposerEditor.caret.test.tsx` 后，整条链一度只剩「裸 Editor + 直接调
 * 插入函数」的单元断言，`onAtQueryChange → ... → insertComposerRefAtom` 这层接线
 * 无人守（评审 3）。这里挂真实组件：用外部 draft 变更触发上报，再用上报到的
 * **文档位置**插入，断言编辑器上报出来的 Markdown。
 *
 * 选区落点由 `composerRefInsert.test.ts` 直接断言（那里能拿到 Editor）；这里覆盖
 * 的是组件这一侧的接口与坐标空间。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  ComposerEditor,
  insertComposerRefAtom,
  removeComposerQueryRange,
  requestComposerStoredCaret,
} from "@/components/composer/tiptap/ComposerEditorTiptap";
import type { ComposerQueryRange } from "@/lib/composerQuery";

// EditorView.scrollToSelection → Range#getClientRects / getBoundingClientRect，
// jsdom 未实现，缺一个就会在 selectionchange 时抛未处理异常。
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
}
if (typeof Range.prototype.getBoundingClientRect !== "function") {
  Range.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
}

afterEach(cleanup);

function Harness({
  value,
  onRange,
  onChange,
  onDom,
}: {
  value: string;
  onRange: (q: ComposerQueryRange | null) => void;
  onChange: (md: string) => void;
  onDom: (el: HTMLDivElement | null) => void;
}) {
  return (
    <ComposerEditor
      value={value}
      onChange={onChange}
      aria-label="t"
      onAtQueryChange={onRange}
      editorRef={onDom}
    />
  );
}

let dom: HTMLDivElement | null = null;

/**
 * 挂载后把正文换成 `next`，并把光标落到文档末尾，返回上报记录。
 * `exceptRange: false` 用于「新正文里本来就没有 `@`」的用例。
 */
async function mountThenValue(next: string, opts: { expectRange?: boolean } = {}) {
  const onRange = vi.fn();
  const onChange = vi.fn();
  const { rerender } = render(
    <Harness
      value=""
      onRange={onRange}
      onChange={onChange}
      onDom={(el) => {
        dom = el;
      }}
    />,
  );
  await waitFor(() => {
    expect(dom).not.toBeNull();
  });
  // 外部 draft 变更路径：先把落点排到末尾，再换正文（编辑器重解析后重算区间）。
  act(() => {
    requestComposerStoredCaret("end");
    rerender(
      <Harness
        value={next}
        onRange={onRange}
        onChange={onChange}
        onDom={(el) => {
          dom = el;
        }}
      />,
    );
  });
  await waitFor(() => {
    expect(onRange).toHaveBeenCalled();
  });
  // 取**首个非空**上报：jsdom 的 contenteditable 选区同步不完整，`focus(pos)` 之后
  // 可能再收到一次带着陈旧选区的 null；真实浏览器里无法在本环境确认。这里要的是
  // 「重解析后按新文档算出的区间」，位置断言见第 1 例。
  const reported = onRange.mock.calls.map(
    (c) => c[0] as ComposerQueryRange | null,
  );
  const range = reported.find((r): r is ComposerQueryRange => r !== null);
  if (opts.expectRange !== false) expect(range).toBeDefined();
  return { range: range as ComposerQueryRange, onChange, onRange, reported };
}

describe("@ 面板接线：上报的文档位置直接用于插入", () => {
  it("空段落：上报 {from,to} 落在 @ 与光标上", async () => {
    // Arrange / Act
    const { range } = await mountThenValue("@ab");

    // Assert —— 段落内容起点 1：'@'=1, 'a'=2, 'b'=3, 光标=4
    expect(range).toEqual({ from: 1, to: 4, query: "ab" });
  });

  it("普通段落：用上报的位置插入，@query 不再残留", async () => {
    // Arrange
    const { range, onChange } = await mountThenValue("在 @ab");

    // Act
    const ok = insertComposerRefAtom(dom, {
      from: range.from,
      to: range.to,
      kind: "file",
      value: "/repo/a.ts",
    });

    // Assert —— chip 落在 `@` 处、`@ab` 不再残留；末尾的分隔空格与旧实现一致
    expect(ok).toBe(true);
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("在 [[file:/repo/a.ts]] ");
    });
  });

  it("列表项：上报的是文档位置，插入不因 `- ` 前缀错位", async () => {
    // Arrange
    const { range, onChange } = await mountThenValue("- 在 @ab");

    // Act
    insertComposerRefAtom(dom, {
      from: range.from,
      to: range.to,
      kind: "file",
      value: "/repo/a.ts",
    });

    // Assert —— 旧实现按 Markdown 源码定位，`- ` 前缀会让它替换掉正文末字
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("- 在 [[file:/repo/a.ts]] ");
    });
  });

  it("不可 token 化的路径回退：删掉 @query 那段，其余正文不动", async () => {
    // Arrange
    const { range, onChange } = await mountThenValue("看 @ab");

    // Act
    const ok = removeComposerQueryRange(dom, {
      from: range.from,
      to: range.to,
    });

    // Assert
    expect(ok).toBe(true);
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("看 ");
    });
  });

  it("重解析后上报的内容一定属于新文档（评审 1）", async () => {
    // 消费方存的是**文档位置**，旧位置在新文档上可能仍落在界内却指向别的正文。
    // 本用例只锁「上报值必须按新文档重算」这一半 —— 另一半（重解析后**必然会**
    // 上报）在 jsdom 里无法构造失败：`setContent` 之后 `onSelectionUpdate` 恰好
    // 也会触发一次上报，所以拿掉的 `emitAt(createdEditor)` 不会被这条测试发现。
    // 那处是显式兜底，不依赖 selectionUpdate 的时机。
    const onRange = vi.fn();
    const { rerender } = render(
      <Harness
        value="旧正文 @ab"
        onRange={onRange}
        onChange={() => undefined}
        onDom={(el) => {
          dom = el;
        }}
      />,
    );
    await waitFor(() => expect(dom).not.toBeNull());

    // Act —— 外部把正文换成另一段带查询的文本（历史回填 / skill 插入）
    act(() => {
      rerender(
        <Harness
          value="新正文 @qq"
          onRange={onRange}
          onChange={() => undefined}
          onDom={(el) => {
            dom = el;
          }}
        />,
      );
    });

    // Assert —— 出现上报，且内容属于新文档
    await waitFor(() => {
      expect(onRange).toHaveBeenCalled();
    });
    const reported = onRange.mock.calls.map(
      (c) => c[0] as ComposerQueryRange | null,
    );
    expect(reported.some((r) => r === null || r.query === "qq")).toBe(true);
    expect(reported.every((r) => r === null || r.query !== "ab")).toBe(true);
  });
});
