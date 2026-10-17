/**
 * @vitest-environment jsdom
 *
 * Watch switch must move on click. SSH ControlPath quoting is covered in
 * src-tauri ssh_remote tests — this file locks the React click path so a
 * failed start cannot look like a dead control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "@/lib/api";
import { SshWatchProvider } from "@/providers/SshWatchProvider";
import { SshHostsPanel } from "./SshHostsPanel";
import type { MessageKey, Vars } from "@/i18n";

const HOST = {
  alias: "UTS",
  hostname: "access.ihpc.uts.edu.au",
  user: "pengqlu",
  port: 22,
};

function t(k: MessageKey, vars?: Vars): string {
  if (k === "settings.ssh.watchError") {
    return `ERR:${vars?.error ?? ""}`;
  }
  return String(k);
}

function renderPanel() {
  return render(
    <SshWatchProvider>
      <SshHostsPanel t={t} />
    </SshWatchProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(api, "isTauri").mockReturnValue(true);
  vi.spyOn(api, "settingsGet").mockResolvedValue({
    sshWatchAliases: [],
  } as unknown as api.AppSettings);
  vi.spyOn(api, "sshListHosts").mockResolvedValue({
    hosts: [HOST],
    configPath: "/Users/me/.ssh/config",
    configExists: true,
    sshFound: true,
  });
  vi.spyOn(api, "sshListSessions").mockResolvedValue({
    ok: true,
    alias: "UTS",
    sessions: [],
  });
  vi.spyOn(api, "sshTestHost").mockResolvedValue({
    alias: "UTS",
    ok: true,
    sshOk: true,
    cli: "ok",
    auth: "ok",
    cliVersion: "grok 1.0.5",
    error: null,
    errorCode: null,
    installCmd: "ssh UTS 'curl'",
    loginCmd: "ssh -t UTS 'grok login --device-auth'",
    installRemoteCmd: "curl",
    loginRemoteCmd: "grok login --device-auth",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SshHostsPanel watch switch", () => {
  it("turns on immediately, then stays on after start succeeds", async () => {
    let resolveStart: (v: api.SshWatchResult) => void = () => {};
    const start = new Promise<api.SshWatchResult>((r) => {
      resolveStart = r;
    });
    vi.spyOn(api, "sshWatchStart").mockReturnValue(start);

    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await user.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    resolveStart({
      ok: true,
      alias: "UTS",
      watching: true,
    });
    await waitFor(() => {
      expect(api.sshWatchStart).toHaveBeenCalledWith("UTS");
    });
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("reverts and shows the OpenSSH error when ControlPath is rejected", async () => {
    vi.spyOn(api, "sshWatchStart").mockResolvedValue({
      ok: false,
      alias: "UTS",
      watching: false,
      error:
        "command-line line 0: keyword controlpath extra arguments at end of line",
    });

    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("switch"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(
        /controlpath extra arguments/i,
      );
    });
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});
