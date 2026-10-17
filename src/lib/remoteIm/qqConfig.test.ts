import { describe, expect, it } from "vitest";
import {
  isQqWsUrl,
  qqHealthHintKeys,
  qqOptionalKeys,
  qqRequiredNonSecretKeys,
  qqRequiredSecretKeys,
  qqSoftStatusMessage,
  qqWsScheme,
  qqWsUrlFromOptions,
  validateQqConfig,
} from "./qqConfig";

describe("isQqWsUrl / scheme", () => {
  it("accepts ws and wss with host", () => {
    expect(isQqWsUrl("ws://127.0.0.1:3001")).toBe(true);
    expect(isQqWsUrl("wss://onebot.example.com/ws")).toBe(true);
    expect(isQqWsUrl("WS://localhost:8080/onebot/v11/ws")).toBe(true);
  });

  it("rejects empty, http, or garbage", () => {
    expect(isQqWsUrl("")).toBe(false);
    expect(isQqWsUrl("http://127.0.0.1:3001")).toBe(false);
    expect(isQqWsUrl("https://example.com")).toBe(false);
    expect(isQqWsUrl("not-a-url")).toBe(false);
    expect(isQqWsUrl("ftp://x")).toBe(false);
  });

  it("detects scheme labels", () => {
    expect(qqWsScheme("wss://x")).toBe("wss");
    expect(qqWsScheme("WS://x")).toBe("ws");
    expect(qqWsScheme("")).toBeNull();
    expect(qqWsScheme("http://x")).toBeNull();
  });
});

describe("qqWsUrlFromOptions", () => {
  it("prefers ws_url over url alias", () => {
    expect(
      qqWsUrlFromOptions({
        ws_url: "ws://a",
        url: "ws://b",
      }),
    ).toEqual({ key: "ws_url", value: "ws://a" });
    expect(qqWsUrlFromOptions({ url: "wss://b" })).toEqual({
      key: "url",
      value: "wss://b",
    });
    expect(qqWsUrlFromOptions({})).toEqual({ key: null, value: "" });
  });
});

describe("qq required / optional keys", () => {
  it("requires ws_url non-secret; token optional", () => {
    expect([...qqRequiredNonSecretKeys()]).toEqual(["ws_url"]);
    expect([...qqRequiredSecretKeys()]).toEqual([]);
    expect(qqOptionalKeys()).toContain("token");
    expect(qqOptionalKeys()).toContain("allow_from");
    expect(qqOptionalKeys()).toContain("url");
  });
});

describe("validateQqConfig", () => {
  it("rejects empty form", () => {
    const r = validateQqConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("ws_url");
    expect(r.softStatus).toBe("missing_ws_url");
    expect(r.transport).toBe("forward_ws");
    expect(r.urlKey).toBeNull();
    expect(qqSoftStatusMessage(r)).toBe("missing_qq_ws_url");
  });

  it("does not treat hasCredentials alone as ready without URL", () => {
    const r = validateQqConfig({
      options: {},
      hasCredentials: true,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("missing_ws_url");
  });

  it("accepts valid ws_url without token", () => {
    const r = validateQqConfig({
      options: { ws_url: "ws://127.0.0.1:3001" },
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_forward_ws");
    expect(r.urlKey).toBe("ws_url");
    expect(r.tokenSet).toBe(false);
    expect(qqSoftStatusMessage(r)).toBe("qq_forward_ws_url_present");
  });

  it("accepts url alias and optional token", () => {
    const r = validateQqConfig({
      options: { url: "wss://bridge.local/onebot" },
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.urlKey).toBe("url");
    expect(r.tokenSet).toBe(true);
    expect(qqSoftStatusMessage(r)).toBe("qq_forward_ws_credentials_present");
  });

  it("soft-fails invalid ws URL scheme", () => {
    const r = validateQqConfig({
      options: { ws_url: "http://127.0.0.1:3001" },
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_ws_url");
    expect(r.missing).toContain("ws_url");
    expect(r.warnings).toContain("http_url_not_ws");
    expect(qqSoftStatusMessage(r)).toBe("invalid_qq_ws_url");
  });

  it("soft-fails garbage URL", () => {
    const r = validateQqConfig({
      options: { ws_url: "not-a-url" },
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_ws_url");
  });

  it("warns on open allow_from without blocking ready", () => {
    const r = validateQqConfig({
      options: {
        ws_url: "ws://127.0.0.1:1",
        allow_from: "*",
      },
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("open_acl");
  });
});

describe("qqHealthHintKeys", () => {
  it("always includes forward WS + self-hosted + community risk", () => {
    const v = validateQqConfig({
      options: { ws_url: "ws://127.0.0.1:3001" },
    });
    const hints = qqHealthHintKeys(v);
    expect(hints.some((k) => k.includes("qqForwardWs"))).toBe(true);
    expect(hints.some((k) => k.includes("qqSelfHosted"))).toBe(true);
    expect(hints.some((k) => k.includes("qqCommunityRisk"))).toBe(true);
    expect(hints.some((k) => k.includes("qqTokenOptional"))).toBe(true);
  });

  it("invalid URL + open ACL + token set hints", () => {
    const bad = validateQqConfig({
      options: { ws_url: "http://bad", allow_from: "*" },
      secretKeysFilled: new Set(["token"]),
    });
    const hints = qqHealthHintKeys(bad, { openAcl: true, tokenInForm: true });
    expect(hints.some((k) => k.includes("qqWsUrlInvalid"))).toBe(true);
    expect(hints.some((k) => k.includes("qqHttpNotWs"))).toBe(true);
    expect(hints.some((k) => k.includes("qqAcl"))).toBe(true);
  });

  it("missing URL hint", () => {
    const v = validateQqConfig({ options: {} });
    const hints = qqHealthHintKeys(v);
    expect(hints.some((k) => k.includes("qqMissingWsUrl"))).toBe(true);
  });

  it("token set when ready and form has token", () => {
    const v = validateQqConfig({
      options: { ws_url: "wss://x.example/ws" },
      secretKeysFilled: new Set(["token"]),
    });
    const hints = qqHealthHintKeys(v, { tokenInForm: true });
    expect(hints.some((k) => k.includes("qqTokenSet"))).toBe(true);
    expect(hints.some((k) => k.includes("qqTokenOptional"))).toBe(false);
  });
});
