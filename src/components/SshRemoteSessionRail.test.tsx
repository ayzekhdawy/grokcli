/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SshRemoteSessionRail } from "./SshRemoteSessionRail";
import type { MessageKey, Vars } from "@/i18n";
import * as api from "@/lib/api";

const loadMore = vi.fn();
const onOpenSession = vi.fn();
const onNewConversation = vi.fn();
const onImportedSessionsChanged = vi.fn();
const setDraftRemote = vi.fn();
const renameRemoteSession = vi.fn();
const refreshSessions = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    sshOpenSession: vi.fn(),
    sshDeleteSessions: vi.fn(),
  };
});

vi.mock("@/providers/SshWatchProvider", () => ({
  useSshWatch: () => ({
    watchAliases: ["UTS"],
    sessionsByAlias: {
      UTS: [
        {
          id: "01a01907-adf3-7e00-a7a8-aee1082b0556",
          cwd: "/data/pengqlu/code/qwen35-v001-light",
          title: "01a01907-adf3-7e00-a7a8-aee1082b0556",
          updatedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
        },
        {
          id: "01a0192c-d7f4-7850-9e0c-3a342201cef10",
          cwd: "/data/pengqlu/code/idea",
          title: "帮我看一下 hallucination span",
          updatedAt: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
        },
        {
          id: "01a0193c-aaaa-7850-9e0c-3a342201cef11",
          cwd: "/data/pengqlu/code/qwen35-v001-light",
          title: "第二轮实验",
          updatedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
        },
      ],
    },
    totalsByAlias: { UTS: 35 },
    titleOverlay: {},
    draftRemote: null,
    setDraftRemote,
    enableWatch: vi.fn(),
    disableWatch: vi.fn(),
    refreshSessions,
    loadMore,
    renameRemoteSession,
  }),
}));

function t(k: MessageKey, vars?: Vars): string {
  if (k === "sidebar.remoteHost") return `远程 ${vars?.alias ?? ""}`;
  if (k === "sidebar.remoteUntitled") return "未命名";
  if (k === "sidebar.remoteRemaining") return `还有 ${vars?.n} 个`;
  if (k === "sidebar.remoteLoadMore") return "加载更多";
  if (k === "sidebar.remoteOpening") return "打开中…";
  if (k === "sidebar.remoteOpenFailed") return `无法打开：${vars?.error ?? ""}`;
  if (k === "sidebar.newConversation") return "新建会话";
  if (k === "sidebar.menu") return "菜单";
  if (k === "sidebar.select") return "选择";
  if (k === "sidebar.selectedCount") return `已选 ${vars?.n} 项`;
  if (k === "sidebar.deleteSelected") return `删除 ${vars?.n}`;
  if (k === "sidebar.selectAllInGroup") return "全选";
  if (k === "sidebar.deselectAllInGroup") return "取消全选";
  if (k === "sidebar.remoteDeleteConfirm")
    return `确定删除 ${vars?.alias} 上的「${vars?.name}」？`;
  if (k === "sidebar.remoteDeleteManyConfirm")
    return `确定删除 ${vars?.alias} 上的 ${vars?.n} 个？`;
  if (k === "session.delete") return "删除会话";
  if (k === "session.deleteTitle") return "删除会话";
  if (k === "session.deleteManyTitle") return "删除会话";
  if (k === "session.renamePrompt") return "重命名";
  if (k === "common.cancel") return "取消";
  return String(k);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SshRemoteSessionRail", () => {
  it("labels the host, groups by path, hides the raw UUID, and offers load more", async () => {
    render(
      <SshRemoteSessionRail
        t={t}
        locale="zh"
        showRelativeTime
        onOpenSession={onOpenSession}
      />,
    );
    expect(screen.getByText("远程 UTS")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "/data/pengqlu/code/qwen35-v001-light",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "/data/pengqlu/code/idea" }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll(".tree-l3--nested").length).toBe(3);
    expect(
      screen.getByRole("button", { name: "qwen35-v001-light" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "帮我看一下 hallucination span" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "第二轮实验" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "01a01907-adf3-7e00-a7a8-aee1082b0556",
      }),
    ).toBeNull();
    expect(screen.getByText("5天前")).toBeInTheDocument();
    expect(screen.getByText("还有 32 个")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /加载更多/ }));
    expect(loadMore).toHaveBeenCalledWith("UTS");
  });

  it("shows opening on the clicked row", async () => {
    let resolveOpen: (v: api.SshOpenSessionResult) => void = () => {};
    vi.mocked(api.sshOpenSession).mockReturnValue(
      new Promise((r) => {
        resolveOpen = r;
      }),
    );
    render(
      <SshRemoteSessionRail
        t={t}
        locale="zh"
        showRelativeTime
        onOpenSession={onOpenSession}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "qwen35-v001-light" }),
    );
    expect(await screen.findByLabelText("打开中…")).toBeInTheDocument();
    resolveOpen({
      ok: true,
      alias: "UTS",
      remoteSessionId: "01a01907-adf3-7e00-a7a8-aee1082b0556",
      appSessionId: "app-1",
    });
    await waitFor(() => {
      expect(onOpenSession).toHaveBeenCalledWith("app-1");
    });
  });

  it("opens remote transcript into a local session", async () => {
    vi.mocked(api.sshOpenSession).mockResolvedValue({
      ok: true,
      alias: "UTS",
      remoteSessionId: "01a01907-adf3-7e00-a7a8-aee1082b0556",
      appSessionId: "app-1",
      title: "qwen35-v001-light",
      messageCount: 4,
    });
    render(
      <SshRemoteSessionRail
        t={t}
        locale="zh"
        showRelativeTime
        onOpenSession={onOpenSession}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "qwen35-v001-light" }),
    );
    await waitFor(() => {
      expect(api.sshOpenSession).toHaveBeenCalled();
      expect(onOpenSession).toHaveBeenCalledWith("app-1");
    });
  });

  it("starts a new conversation in the remote folder path", async () => {
    render(
      <SshRemoteSessionRail
        t={t}
        locale="zh"
        showRelativeTime
        onOpenSession={onOpenSession}
        onNewConversation={onNewConversation}
      />,
    );
    const pens = screen.getAllByTestId("ssh-remote-new-conversation");
    expect(pens.length).toBe(2);
    await userEvent.click(pens[0]);
    expect(onNewConversation).toHaveBeenCalledWith(
      "UTS",
      "/data/pengqlu/code/qwen35-v001-light",
    );
    expect(setDraftRemote).toHaveBeenCalledWith({
      alias: "UTS",
      path: "/data/pengqlu/code/qwen35-v001-light",
    });
    expect(api.sshOpenSession).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("Cmd/Ctrl click enters select mode and does not open", async () => {
    render(
      <SshRemoteSessionRail
        t={t}
        locale="zh"
        showRelativeTime
        onOpenSession={onOpenSession}
      />,
    );
    const row = screen.getByRole("button", { name: "qwen35-v001-light" });
    fireEvent.click(row, { metaKey: true });
    expect(api.sshOpenSession).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(row).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
  });

  it("Cmd/Ctrl click on a second row keeps both selected", async () => {
    render(
      <SshRemoteSessionRail
        t={t}
        locale="zh"
        showRelativeTime
        onOpenSession={onOpenSession}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "qwen35-v001-light" }), {
      metaKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "第二轮实验" }), {
      metaKey: true,
    });
    expect(
      screen.getByRole("button", { name: "qwen35-v001-light" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "第二轮实验" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("Cmd/Ctrl mousedown plus click selects once (does not toggle off)", async () => {
    render(
      <SshRemoteSessionRail
        t={t}
        locale="zh"
        showRelativeTime
        onOpenSession={onOpenSession}
      />,
    );
    const row = screen.getByRole("button", { name: "qwen35-v001-light" });
    fireEvent.mouseDown(row, { metaKey: true, button: 0 });
    fireEvent.click(row, { metaKey: true });
    expect(row).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
  });

  it("right-click delete confirms and removes the remote session", async () => {
    vi.mocked(api.sshDeleteSessions).mockResolvedValue({
      ok: true,
      alias: "UTS",
      deleted: ["01a01907-adf3-7e00-a7a8-aee1082b0556"],
      missing: [],
    });
    render(
      <SshRemoteSessionRail
        t={t}
        locale="zh"
        showRelativeTime
        onOpenSession={onOpenSession}
        onImportedSessionsChanged={onImportedSessionsChanged}
      />,
    );
    const row = screen.getByRole("button", { name: "qwen35-v001-light" });
    fireEvent.contextMenu(row);
    await userEvent.click(screen.getByRole("menuitem", { name: "删除会话" }));
    expect(
      screen.getByText("确定删除 UTS 上的「qwen35-v001-light」？"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "删除会话" }));
    await waitFor(() => {
      expect(api.sshDeleteSessions).toHaveBeenCalledWith("UTS", [
        "01a01907-adf3-7e00-a7a8-aee1082b0556",
      ]);
      expect(refreshSessions).toHaveBeenCalledWith("UTS");
      expect(onImportedSessionsChanged).toHaveBeenCalled();
    });
  });
});
