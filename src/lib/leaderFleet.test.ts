import { describe, expect, it } from "vitest";
import {
  classifyLeaderError,
  deriveLeaderConnectStatus,
  deriveUseLeaderHonesty,
  formatLeaderRowSummary,
  formatLeaderUptimeMs,
  hasLeaderFleet,
  leaderClassificationLabelKey,
  leaderClassificationTone,
  leaderConnectBadgeClass,
  leaderErrorKindHintKey,
  leaderErrorKindLabelKey,
  leaderFleetEmptyMessageKey,
  leaderFleetEmptyReason,
  leaderFleetPidCount,
  leaderInfoDetailRows,
  leaderInfoSoftFail,
  leaderRowKey,
  normalizeLeaderClassification,
} from "./leaderFleet";

describe("leaderFleet", () => {
  it("leaderRowKey prefers pid then socket", () => {
    expect(leaderRowKey({ pid: 12 }, 0)).toBe("pid-12");
    expect(leaderRowKey({ socketPath: "/tmp/a.sock" }, 1)).toBe("sock-/tmp/a.sock");
    expect(leaderRowKey({}, 3)).toBe("idx-3");
  });

  it("formatLeaderRowSummary joins known fields", () => {
    expect(
      formatLeaderRowSummary({
        pid: 7601,
        classification: "Reachable",
        version: "0.2.1",
        socketPath: "/Users/x/.grok/leader.sock",
      }),
    ).toBe("PID 7601 · Reachable · v0.2.1 · /Users/x/.grok/leader.sock");
    expect(formatLeaderRowSummary({})).toBe("—");
  });

  it("formatLeaderUptimeMs formats buckets", () => {
    expect(formatLeaderUptimeMs(null)).toBeNull();
    expect(formatLeaderUptimeMs(-1)).toBeNull();
    expect(formatLeaderUptimeMs(4500)).toBe("4s");
    expect(formatLeaderUptimeMs(125_000)).toBe("2m 5s");
    expect(formatLeaderUptimeMs(3_600_000)).toBe("1h");
    expect(formatLeaderUptimeMs(3_660_000)).toBe("1h 1m");
  });

  it("leaderInfoDetailRows maps structured fields with i18n label keys", () => {
    const rows = leaderInfoDetailRows({
      pid: 42,
      socketPath: "/tmp/l.sock",
      version: "0.3.1",
      protocolVersion: "1",
      classification: "Reachable",
      uptimeMs: 12_000,
      activeToolCalls: 2,
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.pid?.value).toBe("42");
    expect(byKey.pid?.labelKey).toBe("settings.leader.field.pid");
    expect(byKey.socketPath?.value).toBe("/tmp/l.sock");
    expect(byKey.socketPath?.labelKey).toBe("settings.leader.field.socketPath");
    expect(byKey.version?.value).toBe("0.3.1");
    expect(byKey.protocolVersion?.value).toBe("1");
    expect(byKey.uptime?.value).toBe("12s");
    expect(byKey.activeToolCalls?.value).toBe("2");
  });

  it("leaderInfoDetailRows falls back to raw JSON", () => {
    const rows = leaderInfoDetailRows({ raw: { foo: "bar" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("raw");
    expect(rows[0].labelKey).toBe("settings.leader.field.raw");
    expect(rows[0].value).toContain("foo");
  });

  it("hasLeaderFleet and pid count", () => {
    expect(hasLeaderFleet(null)).toBe(false);
    expect(hasLeaderFleet([])).toBe(false);
    expect(hasLeaderFleet([{ pid: 1 }])).toBe(true);
    expect(leaderFleetPidCount([{ pid: 1 }, {}, { pid: 2 }])).toBe(2);
    expect(leaderFleetPidCount(null)).toBe(0);
  });
});

describe("classifyLeaderError", () => {
  it("detects cli missing / unsupported / timeout / parse", () => {
    expect(classifyLeaderError("Grok Build CLI not found")).toBe("cli_missing");
    expect(classifyLeaderError("This CLI does not expose leader")).toBe("unsupported");
    expect(classifyLeaderError("unknown subcommand info", { unsupported: true })).toBe(
      "unsupported",
    );
    expect(classifyLeaderError("grok command timed out after 15s")).toBe("timeout");
    expect(classifyLeaderError("invalid leader list JSON: eof")).toBe("parse");
  });

  it("detects stale socket and list/info sources", () => {
    expect(
      classifyLeaderError("Leader socket exists but no reachable leader process was listed."),
    ).toBe("socket_stale");
    expect(classifyLeaderError("grok leader list failed", { source: "list" })).toBe(
      "list_failed",
    );
    expect(classifyLeaderError("something went wrong", { source: "info" })).toBe(
      "info_failed",
    );
    expect(classifyLeaderError("connection refused")).toBe("unreachable");
    expect(classifyLeaderError("")).toBe("other");
  });
});

describe("normalizeLeaderClassification", () => {
  it("maps known CLI strings", () => {
    expect(normalizeLeaderClassification("Reachable")).toBe("reachable");
    expect(normalizeLeaderClassification("running")).toBe("running");
    expect(normalizeLeaderClassification("Unreachable")).toBe("unreachable");
    expect(normalizeLeaderClassification("stale")).toBe("stale");
    expect(normalizeLeaderClassification("")).toBe("unknown");
    expect(normalizeLeaderClassification("weird")).toBe("unknown");
  });

  it("tones and label keys", () => {
    expect(leaderClassificationTone("reachable")).toBe("ok");
    expect(leaderClassificationTone("stale")).toBe("warn");
    expect(leaderClassificationTone("unreachable")).toBe("err");
    expect(leaderClassificationLabelKey("reachable")).toBe(
      "settings.leader.class.reachable",
    );
    expect(leaderErrorKindLabelKey("socket_stale")).toBe(
      "settings.leader.err.socketStale",
    );
    expect(leaderErrorKindHintKey("cli_missing")).toBe(
      "settings.leader.hint.cliMissing",
    );
  });
});

describe("deriveLeaderConnectStatus", () => {
  it("running when host state running or listed PIDs", () => {
    const a = deriveLeaderConnectStatus({
      state: "running",
      cliFound: true,
      cliSupportsLeader: true,
      socketExists: true,
      leaders: [{ pid: 1, classification: "Reachable" }],
    });
    expect(a.phase).toBe("running");
    expect(a.tone).toBe("ok");
    expect(a.socketOnlyRunningGuess).toBe(false);
    expect(a.labelKey).toBe("settings.leader.stateRunning");
  });

  it("never invents running from socket alone", () => {
    const a = deriveLeaderConnectStatus({
      state: "error",
      cliFound: true,
      cliSupportsLeader: true,
      socketExists: true,
      leaders: [],
      message: "Leader socket exists but no reachable leader process was listed.",
    });
    expect(a.phase).toBe("stale_socket");
    expect(a.errorKind).toBe("socket_stale");
    expect(a.showDiagnostic).toBe(true);
    expect(a.socketOnlyRunningGuess).toBe(false);
  });

  it("unsupported and cli missing", () => {
    expect(
      deriveLeaderConnectStatus({
        state: "unsupported",
        cliFound: true,
        cliSupportsLeader: false,
        leaders: [],
      }).phase,
    ).toBe("unsupported");

    const missing = deriveLeaderConnectStatus({
      state: "error",
      cliFound: false,
      cliSupportsLeader: false,
      leaders: [],
      message: "Grok Build CLI not found",
    });
    expect(missing.phase).toBe("cli_missing");
    expect(missing.showDiagnostic).toBe(true);
  });

  it("shows soft diagnostic when stopped with list message", () => {
    const a = deriveLeaderConnectStatus({
      state: "stopped",
      cliFound: true,
      cliSupportsLeader: true,
      socketExists: false,
      leaders: [],
      message: "grok leader list failed: timed out",
    });
    expect(a.phase).toBe("soft_diagnostic");
    expect(a.showDiagnostic).toBe(true);
    expect(a.labelKey).toBe("settings.leader.stateStopped");
    expect(a.errorKind).toBe("timeout");
  });

  it("stopped clean", () => {
    const a = deriveLeaderConnectStatus({
      state: "stopped",
      cliFound: true,
      cliSupportsLeader: true,
      socketExists: false,
      leaders: [],
    });
    expect(a.phase).toBe("stopped");
    expect(a.tone).toBe("muted");
    expect(a.showDiagnostic).toBe(false);
  });
});

describe("deriveUseLeaderHonesty", () => {
  it("warns when share-backend is on but leader not running", () => {
    const h = deriveUseLeaderHonesty({ useLeader: true, phase: "stopped" });
    expect(h.severity).toBe("warn");
    expect(h.messageKey).toBe("settings.leader.honesty.useLeaderNotRunning");
    expect(h.showStartLeader).toBe(true);
  });

  it("info when leader running but useLeader off", () => {
    const h = deriveUseLeaderHonesty({ useLeader: false, phase: "running" });
    expect(h.severity).toBe("info");
    expect(h.messageKey).toBe("settings.leader.honesty.runningNoUseLeader");
    expect(h.showOpenUseLeader).toBe(true);
  });

  it("silent when aligned", () => {
    expect(
      deriveUseLeaderHonesty({ useLeader: true, phase: "running" }).severity,
    ).toBe("none");
    expect(
      deriveUseLeaderHonesty({ useLeader: false, phase: "stopped" }).severity,
    ).toBe("none");
  });
});

describe("fleet empty + info soft-fail", () => {
  it("empty reasons", () => {
    expect(
      leaderFleetEmptyReason({ phase: "unsupported", fleetCount: 0 }),
    ).toBe("unsupported");
    expect(
      leaderFleetEmptyReason({
        phase: "soft_diagnostic",
        errorKind: "list_failed",
        fleetCount: 0,
      }),
    ).toBe("soft_list");
    expect(leaderFleetEmptyMessageKey("soft_list")).toBe(
      "settings.leader.fleetEmptySoft",
    );
    expect(leaderFleetEmptyReason({ phase: "stopped", fleetCount: 1 })).toBe("none");
  });

  it("leaderInfoSoftFail", () => {
    expect(leaderInfoSoftFail(null).soft).toBe(false);
    expect(leaderInfoSoftFail({ unsupported: true }).kind).toBe("unsupported");
    const fail = leaderInfoSoftFail({ error: "unknown subcommand info" });
    expect(fail.soft).toBe(true);
    expect(fail.kind).toBe("unsupported");
  });

  it("badge class mapping", () => {
    expect(leaderConnectBadgeClass("ok")).toContain("ok");
    expect(leaderConnectBadgeClass("err")).toContain("warn");
    expect(leaderConnectBadgeClass("muted")).toContain("muted");
  });
});
