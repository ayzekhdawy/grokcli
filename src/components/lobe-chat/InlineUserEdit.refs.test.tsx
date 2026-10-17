/**
 * @vitest-environment jsdom
 *
 * 回归（验收 C14）：编辑已发送的消息不能丢正文里的内联引用。
 *
 * 用户只改措辞，引用段却会被整体丢弃 —— 打开编辑框时正文里就没有了 `@路径`，
 * 提交后写回的 stored 内容也不含 `[[file:…]]`，等于静默删掉一条引用。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { InlineUserEdit } from "./InlineUserEdit";
import type { AttachmentCardLabels } from "@/components/AttachmentCard";

const attachLabels: AttachmentCardLabels = {
  open: "open",
  reveal: "reveal",
  copyPath: "copyPath",
  copyImage: "copyImage",
  addToComposer: "add",
};

afterEach(cleanup);

function renderEdit(content: string) {
  const onSubmit = vi.fn();
  const utils = render(
    <InlineUserEdit
      content={content}
      attachLabels={attachLabels}
      cancelLabel="cancel"
      resendLabel="resend"
      onCancel={() => undefined}
      onSubmit={onSubmit}
    />,
  );
  const textarea = utils.getByRole("textbox") as HTMLTextAreaElement;
  return { ...utils, onSubmit, textarea };
}

describe("InlineUserEdit 与内联引用", () => {
  it("打开编辑框时正文里看得到引用的 agent 形态，位置不动", () => {
    // Arrange / Act
    const { textarea } = renderEdit("在 [[file:/repo/src/a.ts]] 中找到 xxx");

    // Assert —— 丢掉引用时这里会是「在  中找到 xxx」
    expect(textarea.value).toBe("在 @/repo/src/a.ts 中找到 xxx");
  });

  it("只改措辞后提交，引用仍以 token 写回", () => {
    // Arrange
    const { onSubmit, textarea, getByText } = renderEdit(
      "在 [[file:/repo/src/a.ts]] 中找到 xxx",
    );

    // Act —— 用户把「xxx」改成「yyy」，不碰引用
    fireEvent.change(textarea, {
      target: { value: "在 @/repo/src/a.ts 中找到 yyy" },
    });
    fireEvent.click(getByText("resend"));

    // Assert
    expect(onSubmit).toHaveBeenCalledWith(
      "在 [[file:/repo/src/a.ts]] 中找到 yyy",
    );
  });

  it("用户把引用文本删掉后，消息里也不再留下引用", () => {
    // Arrange
    const { onSubmit, textarea, getByText } = renderEdit(
      "[[url:https://x.y/z]] 看这个",
    );

    // Act
    fireEvent.change(textarea, { target: { value: "看这个" } });
    fireEvent.click(getByText("resend"));

    // Assert —— 用户删了就是删了，不猜也不补
    expect(onSubmit).toHaveBeenCalledWith("看这个");
  });

  it("用户改写过的 @路径 按普通文本留下", () => {
    // Arrange
    const { onSubmit, textarea, getByText } = renderEdit(
      "[[file:/repo/a.ts]] 里",
    );

    // Act
    fireEvent.change(textarea, { target: { value: "@/repo/other.ts 里" } });
    fireEvent.click(getByText("resend"));

    // Assert
    expect(onSubmit).toHaveBeenCalledWith("@/repo/other.ts 里");
  });

  it("技能 chip 与引用同时存在时都保留", () => {
    // Arrange
    const { onSubmit, getByText } = renderEdit(
      "[[skill:review]] 看 [[file:/repo/a.ts]]",
    );

    // Act —— 不动正文直接提交
    fireEvent.click(getByText("resend"));

    // Assert —— skill 提到最前是既有约定；引用连周围文字一起留在原地，
    // 「看」不会被挪到引用后面
    expect(onSubmit).toHaveBeenCalledWith(
      "[[skill:review]] 看 [[file:/repo/a.ts]]",
    );
  });
});
