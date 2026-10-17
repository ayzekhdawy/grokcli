import { describe, expect, it } from "vitest";
import {
  isLineCallbackPath,
  lineCloudflaredSnippet,
  lineHealthHintKeys,
  lineRequiredSecretKeys,
  lineSoftStatusMessage,
  LINE_DEFAULT_CALLBACK_PATH,
  LINE_DEFAULT_WEBHOOK_PORT,
  normalizeLineCallbackPath,
  parseLineWebhookPort,
  validateLineConfig,
} from "./lineConfig";

describe("parseLineWebhookPort", () => {
  it("accepts empty / default and valid ports", () => {
    expect(parseLineWebhookPort("")).toEqual({ ok: true, port: null });
    expect(parseLineWebhookPort(undefined)).toEqual({ ok: true, port: null });
    expect(parseLineWebhookPort(8081)).toEqual({ ok: true, port: 8081 });
    expect(parseLineWebhookPort("443")).toEqual({ ok: true, port: 443 });
    expect(parseLineWebhookPort("65535")).toEqual({ ok: true, port: 65535 });
  });

  it("rejects out of range and garbage", () => {
    expect(parseLineWebhookPort(0).ok).toBe(false);
    expect(parseLineWebhookPort(65536).ok).toBe(false);
    expect(parseLineWebhookPort("nope").ok).toBe(false);
    expect(parseLineWebhookPort(3.14).ok).toBe(false);
  });
});

describe("isLineCallbackPath / normalize", () => {
  it("allows empty and absolute paths", () => {
    expect(isLineCallbackPath("")).toBe(true);
    expect(isLineCallbackPath("/line/callback")).toBe(true);
    expect(isLineCallbackPath("/hook")).toBe(true);
  });

  it("rejects schemes, spaces, relative paths", () => {
    expect(isLineCallbackPath("line/callback")).toBe(false);
    expect(isLineCallbackPath("https://x/hook")).toBe(false);
    expect(isLineCallbackPath("/has space")).toBe(false);
  });

  it("normalizes empty to default and prefixes slash", () => {
    expect(normalizeLineCallbackPath("")).toBe(LINE_DEFAULT_CALLBACK_PATH);
    expect(normalizeLineCallbackPath("hook")).toBe("/hook");
    expect(normalizeLineCallbackPath("/ok")).toBe("/ok");
  });
});

describe("lineCloudflaredSnippet", () => {
  it("defaults to product port 8081", () => {
    expect(lineCloudflaredSnippet()).toBe(
      `cloudflared tunnel --url http://127.0.0.1:${LINE_DEFAULT_WEBHOOK_PORT}`,
    );
    expect(lineCloudflaredSnippet("")).toBe(
      "cloudflared tunnel --url http://127.0.0.1:8081",
    );
    expect(lineCloudflaredSnippet("bad")).toBe(
      "cloudflared tunnel --url http://127.0.0.1:8081",
    );
  });

  it("uses custom valid port", () => {
    expect(lineCloudflaredSnippet(9000)).toBe(
      "cloudflared tunnel --url http://127.0.0.1:9000",
    );
    expect(lineCloudflaredSnippet("9443")).toBe(
      "cloudflared tunnel --url http://127.0.0.1:9443",
    );
  });
});

describe("line required keys", () => {
  it("requires channel_secret + channel_access_token", () => {
    expect([...lineRequiredSecretKeys()]).toEqual([
      "channel_secret",
      "channel_access_token",
    ]);
  });
});

describe("validateLineConfig", () => {
  it("rejects empty form", () => {
    const r = validateLineConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.transport).toBe("webhook");
    expect(r.needsPublicUrl).toBe(true);
    expect(r.missing).toContain("channel_secret");
    expect(r.missing).toContain("channel_access_token");
    expect(r.softStatus).toBe("missing_credentials");
    expect(r.port).toBe(LINE_DEFAULT_WEBHOOK_PORT);
    expect(r.callbackPath).toBe(LINE_DEFAULT_CALLBACK_PATH);
    expect(lineSoftStatusMessage(r)).toBe("missing_line_credentials");
  });

  it("accepts complete bind via form secret key presence", () => {
    const r = validateLineConfig({
      options: {},
      secretKeysFilled: new Set([
        "channel_secret",
        "channel_access_token",
      ]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_webhook");
    expect(r.missing).toEqual([]);
    expect(lineSoftStatusMessage(r)).toBe("line_webhook_credentials_present");
  });

  it("accepts access_token alias for channel_access_token", () => {
    const r = validateLineConfig({
      options: {},
      secretKeysFilled: new Set(["channel_secret", "access_token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_webhook");
  });

  it("accepts vault reuse when hasCredentials", () => {
    const r = validateLineConfig({
      options: { port: 8081 },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_webhook");
    expect(r.portSet).toBe(true);
    // Default port 8081 is not "custom"
    expect(lineSoftStatusMessage(r)).toBe("line_webhook_credentials_present");
  });

  it("notes custom port in soft message when non-default", () => {
    const r = validateLineConfig({
      options: { port: 9443 },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(lineSoftStatusMessage(r)).toBe(
      "line_webhook_credentials_present_custom_port",
    );
  });

  it("soft-fails invalid port", () => {
    const r = validateLineConfig({
      options: { port: "not-a-port" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_port");
    expect(r.missing).toContain("port");
    expect(lineSoftStatusMessage(r)).toBe("invalid_line_port");
  });

  it("soft-fails invalid callback_path", () => {
    const r = validateLineConfig({
      options: { callback_path: "relative/path" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_callback_path");
    expect(lineSoftStatusMessage(r)).toBe("invalid_line_callback_path");
  });

  it("ready with custom path + port", () => {
    const r = validateLineConfig({
      options: { port: 9443, callback_path: "/hooks/line" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.port).toBe(9443);
    expect(r.callbackPath).toBe("/hooks/line");
    expect(r.warnings).toContain("custom_callback_path");
  });

  it("incomplete when only one secret filled", () => {
    const r = validateLineConfig({
      options: {},
      secretKeysFilled: new Set(["channel_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("incomplete");
    expect(r.missing).toContain("channel_access_token");
  });
});

describe("lineHealthHintKeys", () => {
  it("always includes webhook + public URL + tunnel + no-live-claim", () => {
    const v = validateLineConfig({
      options: {},
      hasCredentials: true,
    });
    const hints = lineHealthHintKeys(v);
    expect(hints.some((k) => k.includes("lineWebhook"))).toBe(true);
    expect(hints.some((k) => k.includes("linePublicUrl"))).toBe(true);
    expect(hints.some((k) => k.includes("lineTunnel"))).toBe(true);
    expect(hints.some((k) => k.includes("lineNoLiveClaim"))).toBe(true);
  });

  it("missing + invalid port/path + open ACL", () => {
    const missing = validateLineConfig({
      options: {},
      hasCredentials: false,
    });
    const h0 = lineHealthHintKeys(missing);
    expect(h0.some((k) => k.includes("lineMissingKeys"))).toBe(true);

    const badPort = validateLineConfig({
      options: { port: "x" },
      hasCredentials: true,
    });
    expect(
      lineHealthHintKeys(badPort).some((k) => k.includes("linePortInvalid")),
    ).toBe(true);

    const custom = validateLineConfig({
      options: { port: 9000, callback_path: "/custom" },
      hasCredentials: true,
    });
    const h1 = lineHealthHintKeys(custom, { openAcl: true });
    expect(h1.some((k) => k.includes("linePortCustom"))).toBe(true);
    expect(h1.some((k) => k.includes("linePathCustom"))).toBe(true);
    expect(h1.some((k) => k.includes("openAcl"))).toBe(true);
  });
});
