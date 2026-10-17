import { describe, expect, it } from "vitest";
import {
  connPillForState,
  connPillRetryable,
  isViewedSessionConnecting,
  shouldDisableReconnectBecauseConnecting,
} from "./connStatus";

describe("connPillForState", () => {
  it("maps ready / streaming / disconnected", () => {
    expect(connPillForState("ready")).toEqual({
      tone: "ok",
      labelKey: "conn.ready",
    });
    expect(connPillForState("streaming")).toEqual({
      tone: "ok",
      labelKey: "conn.streaming",
    });
    expect(connPillForState("disconnected")).toEqual({
      tone: "err",
      labelKey: "conn.disconnected",
    });
  });

  it("treats connecting flag as warn even if state lags", () => {
    expect(connPillForState("idle", true)).toEqual({
      tone: "warn",
      labelKey: "conn.connecting",
    });
  });

  it("maps permission wait", () => {
    expect(connPillForState("awaiting_permission").labelKey).toBe(
      "conn.permission",
    );
  });
});

describe("isViewedSessionConnecting", () => {
  it("ignores a foreign chat's in-flight connect", () => {
    expect(
      isViewedSessionConnecting("chat-a", new Set(["chat-b"])),
    ).toBe(false);
  });

  it("matches the viewed session and the draft key", () => {
    expect(
      isViewedSessionConnecting("chat-a", new Set(["chat-a"])),
    ).toBe(true);
    expect(isViewedSessionConnecting(null, new Set(["__draft__"]))).toBe(true);
  });
});

describe("connPillRetryable", () => {
  it("lets the user retry a stuck handshake or a dropped agent", () => {
    expect(connPillRetryable("connecting", false)).toBe(true);
    expect(connPillRetryable("idle", true)).toBe(true);
    expect(connPillRetryable("disconnected", false)).toBe(true);
    expect(connPillRetryable("ready", false)).toBe(false);
    expect(connPillRetryable("streaming", false)).toBe(false);
  });
});

describe("shouldDisableReconnectBecauseConnecting", () => {
  it("never disables Reconnect just because a handshake is in flight", () => {
    expect(shouldDisableReconnectBecauseConnecting(true)).toBe(false);
    expect(shouldDisableReconnectBecauseConnecting(false)).toBe(false);
  });
});
