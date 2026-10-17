import { afterEach, describe, expect, it, vi } from "vitest";
import {
  killTerminalPtySession,
  killTerminalPtySessions,
  peekTerminalPtySession,
  registerTerminalPtySession,
  takeTerminalPtySession,
} from "./terminalPtySession";

afterEach(() => {
  for (const id of ["tab-a", "tab-b", "tab-c"]) {
    takeTerminalPtySession(id);
  }
});

describe("terminal PTY session registry", () => {
  it("register then take returns the session once", () => {
    registerTerminalPtySession("tab-a", "pty_1");
    expect(peekTerminalPtySession("tab-a")).toBe("pty_1");
    expect(takeTerminalPtySession("tab-a")).toBe("pty_1");
    expect(takeTerminalPtySession("tab-a")).toBeNull();
    expect(peekTerminalPtySession("tab-a")).toBeNull();
  });

  it("kill invokes host kill and forgets the tab", async () => {
    const kill = vi.fn(async (_sessionId: string) => undefined);
    registerTerminalPtySession("tab-a", "pty_1");
    await killTerminalPtySession("tab-a", kill);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith("pty_1");
    expect(peekTerminalPtySession("tab-a")).toBeNull();
    await killTerminalPtySession("tab-a", kill);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("kill many drops every listed tab", async () => {
    const kill = vi.fn(async (_sessionId: string) => undefined);
    registerTerminalPtySession("tab-a", "pty_1");
    registerTerminalPtySession("tab-b", "pty_2");
    registerTerminalPtySession("tab-c", "pty_3");
    await killTerminalPtySessions(["tab-a", "tab-c"], kill);
    expect(kill.mock.calls.map((c) => c[0]).sort()).toEqual(["pty_1", "pty_3"]);
    expect(peekTerminalPtySession("tab-b")).toBe("pty_2");
    takeTerminalPtySession("tab-b");
  });
});
