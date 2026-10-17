import { describe, expect, it } from "vitest";
import {
  normalizeAcpServerAddrForSettings,
  parseAcpServerAddr,
} from "./acpServerAddr";

describe("parseAcpServerAddr", () => {
  it("accepts host:port", () => {
    expect(parseAcpServerAddr("127.0.0.1:8799")).toEqual({
      ok: true,
      host: "127.0.0.1",
      port: 8799,
      normalized: "127.0.0.1:8799",
    });
    expect(parseAcpServerAddr("localhost:2419")).toEqual({
      ok: true,
      host: "localhost",
      port: 2419,
      normalized: "localhost:2419",
    });
    expect(parseAcpServerAddr("  agent.example.com:9000  ")).toEqual({
      ok: true,
      host: "agent.example.com",
      port: 9000,
      normalized: "agent.example.com:9000",
    });
  });

  it("strips optional ws/tcp/http schemes", () => {
    expect(parseAcpServerAddr("ws://127.0.0.1:8799")).toEqual({
      ok: true,
      host: "127.0.0.1",
      port: 8799,
      normalized: "127.0.0.1:8799",
    });
    expect(parseAcpServerAddr("wss://host.local:1")).toMatchObject({
      ok: true,
      host: "host.local",
      port: 1,
    });
    expect(parseAcpServerAddr("tcp://10.0.0.2:65535")).toMatchObject({
      ok: true,
      host: "10.0.0.2",
      port: 65535,
    });
    expect(parseAcpServerAddr("http://127.0.0.1:80")).toMatchObject({
      ok: true,
      host: "127.0.0.1",
      port: 80,
    });
  });

  it("accepts bracketed IPv6", () => {
    expect(parseAcpServerAddr("[::1]:8799")).toEqual({
      ok: true,
      host: "::1",
      port: 8799,
      normalized: "[::1]:8799",
    });
  });

  it("rejects empty", () => {
    expect(parseAcpServerAddr("")).toEqual({ ok: false, error: "empty" });
    expect(parseAcpServerAddr("   ")).toEqual({ ok: false, error: "empty" });
    expect(parseAcpServerAddr(null)).toEqual({ ok: false, error: "empty" });
    expect(parseAcpServerAddr(undefined)).toEqual({
      ok: false,
      error: "empty",
    });
  });

  it("rejects empty host", () => {
    expect(parseAcpServerAddr(":8799")).toEqual({
      ok: false,
      error: "empty_host",
    });
  });

  it("rejects missing / invalid port", () => {
    expect(parseAcpServerAddr("localhost")).toEqual({
      ok: false,
      error: "missing_port",
    });
    expect(parseAcpServerAddr("localhost:")).toEqual({
      ok: false,
      error: "missing_port",
    });
    expect(parseAcpServerAddr("localhost:0")).toEqual({
      ok: false,
      error: "invalid_port",
    });
    expect(parseAcpServerAddr("localhost:65536")).toEqual({
      ok: false,
      error: "invalid_port",
    });
    expect(parseAcpServerAddr("localhost:abc")).toEqual({
      ok: false,
      error: "invalid_port",
    });
    expect(parseAcpServerAddr("localhost:-1")).toEqual({
      ok: false,
      error: "invalid_port",
    });
  });

  it("rejects obvious junk", () => {
    expect(parseAcpServerAddr("not a host")).toEqual({
      ok: false,
      error: "missing_port",
    });
    expect(parseAcpServerAddr("127.0.0.1:8799/path")).toEqual({
      ok: false,
      error: "junk",
    });
    expect(parseAcpServerAddr("fe80::1")).toEqual({
      ok: false,
      error: "junk",
    });
    expect(parseAcpServerAddr("host:port:extra")).toEqual({
      ok: false,
      error: "junk",
    });
    expect(parseAcpServerAddr("bad host:8799")).toEqual({
      ok: false,
      error: "invalid_host",
    });
  });
});

describe("normalizeAcpServerAddrForSettings", () => {
  it("maps empty to null (local CLI)", () => {
    expect(normalizeAcpServerAddrForSettings("")).toEqual({
      ok: true,
      value: null,
    });
    expect(normalizeAcpServerAddrForSettings("  ")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("normalizes valid addresses", () => {
    expect(normalizeAcpServerAddrForSettings("ws://127.0.0.1:8799")).toEqual({
      ok: true,
      value: "127.0.0.1:8799",
    });
  });

  it("rejects invalid non-empty", () => {
    expect(normalizeAcpServerAddrForSettings("nope")).toEqual({
      ok: false,
      error: "missing_port",
    });
  });
});
