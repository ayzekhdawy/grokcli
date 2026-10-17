import { describe, expect, it } from "vitest";
import {
  isWeiboAppIdFormat,
  isWeiboTokenEndpointUrl,
  isWeiboWsEndpointUrl,
  validateWeiboConfig,
  weiboHealthHintKeys,
  weiboOptionalKeys,
  weiboRequiredNonSecretKeys,
  weiboRequiredSecretKeys,
  weiboSoftStatusMessage,
} from "./weiboConfig";

describe("isWeiboAppIdFormat", () => {
  it("accepts numeric and alphanumeric app keys", () => {
    expect(isWeiboAppIdFormat("1234567890")).toBe(true);
    expect(isWeiboAppIdFormat("wb_app_key_01")).toBe(true);
    expect(isWeiboAppIdFormat("AppKey.v1")).toBe(true);
  });

  it("rejects empty, whitespace, or short garbage", () => {
    expect(isWeiboAppIdFormat("")).toBe(false);
    expect(isWeiboAppIdFormat("  ")).toBe(false);
    expect(isWeiboAppIdFormat("ab")).toBe(false);
    expect(isWeiboAppIdFormat("has space")).toBe(false);
  });
});

describe("isWeiboTokenEndpointUrl", () => {
  it("accepts empty and absolute http(s)", () => {
    expect(isWeiboTokenEndpointUrl("")).toBe(true);
    expect(isWeiboTokenEndpointUrl("  ")).toBe(true);
    expect(
      isWeiboTokenEndpointUrl("https://api.weibo.com/oauth2/access_token"),
    ).toBe(true);
    expect(isWeiboTokenEndpointUrl("http://localhost:8080/token")).toBe(true);
  });

  it("rejects non-http schemes and bare hosts", () => {
    expect(isWeiboTokenEndpointUrl("wss://api.weibo.com/token")).toBe(false);
    expect(isWeiboTokenEndpointUrl("not a url")).toBe(false);
    expect(isWeiboTokenEndpointUrl("api.weibo.com/token")).toBe(false);
  });
});

describe("isWeiboWsEndpointUrl", () => {
  it("accepts empty, ws(s), and http(s)", () => {
    expect(isWeiboWsEndpointUrl("")).toBe(true);
    expect(isWeiboWsEndpointUrl("wss://api.weibo.com/chat")).toBe(true);
    expect(isWeiboWsEndpointUrl("ws://127.0.0.1:9000/ws")).toBe(true);
    expect(isWeiboWsEndpointUrl("https://api.weibo.com/chat")).toBe(true);
  });

  it("rejects garbage and unsupported schemes", () => {
    expect(isWeiboWsEndpointUrl("ftp://x")).toBe(false);
    expect(isWeiboWsEndpointUrl("not-a-url")).toBe(false);
  });
});

describe("weibo required / optional keys", () => {
  it("requires app_id + app_secret; advanced endpoints optional", () => {
    expect([...weiboRequiredNonSecretKeys()]).toEqual(["app_id"]);
    expect([...weiboRequiredSecretKeys()]).toEqual(["app_secret"]);
    expect(weiboOptionalKeys()).toContain("allow_from");
    expect(weiboOptionalKeys()).toContain("token_endpoint");
    expect(weiboOptionalKeys()).toContain("ws_endpoint");
  });
});

describe("validateWeiboConfig", () => {
  it("rejects empty form", () => {
    const r = validateWeiboConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.transport).toBe("websocket");
    expect(r.needsPublicUrl).toBe(false);
    expect(r.missing).toContain("app_id");
    expect(r.missing).toContain("app_secret");
    expect(r.softStatus).toBe("missing_credentials");
    expect(weiboSoftStatusMessage(r)).toBe("missing_weibo_credentials");
  });

  it("accepts complete bind via form secret key presence", () => {
    const r = validateWeiboConfig({
      options: { app_id: "1234567890", allow_from: "*" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_ws");
    expect(r.missing).toEqual([]);
    expect(r.warnings).toContain("open_acl");
    expect(weiboSoftStatusMessage(r)).toBe("weibo_ws_credentials_present");
  });

  it("accepts vault reuse when hasCredentials", () => {
    const r = validateWeiboConfig({
      options: { app_id: "wb_app_01" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_ws");
  });

  it("accepts app_key alias and secret aliases", () => {
    expect(
      validateWeiboConfig({
        options: { app_key: "1234567890" },
        secretKeysFilled: new Set(["secret"]),
      }).ok,
    ).toBe(true);
    expect(
      validateWeiboConfig({
        options: { app_id: "1234567890" },
        secretKeysFilled: new Set(["appSecret"]),
      }).ok,
    ).toBe(true);
  });

  it("soft-fails invalid app_id format", () => {
    const r = validateWeiboConfig({
      options: { app_id: "ab" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_app_id_format");
    expect(weiboSoftStatusMessage(r)).toBe("invalid_weibo_app_id_format");
  });

  it("soft-fails invalid token_endpoint", () => {
    const r = validateWeiboConfig({
      options: {
        app_id: "1234567890",
        token_endpoint: "not-a-url",
      },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_token_endpoint");
    expect(r.missing).toContain("token_endpoint");
    expect(weiboSoftStatusMessage(r)).toBe("invalid_weibo_token_endpoint");
  });

  it("soft-fails invalid ws_endpoint", () => {
    const r = validateWeiboConfig({
      options: {
        app_id: "1234567890",
        ws_endpoint: "ftp://bad",
      },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_ws_endpoint");
    expect(weiboSoftStatusMessage(r)).toBe("invalid_weibo_ws_endpoint");
  });

  it("accepts advanced endpoints with valid shapes", () => {
    const r = validateWeiboConfig({
      options: {
        app_id: "1234567890",
        token_endpoint: "https://api.weibo.com/oauth2/access_token",
        ws_endpoint: "wss://api.weibo.com/chat",
      },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.customTokenEndpoint).toBe(true);
    expect(r.customWsEndpoint).toBe(true);
  });

  it("accepts ws_url alias for custom WS endpoint", () => {
    const r = validateWeiboConfig({
      options: {
        app_id: "1234567890",
        ws_url: "wss://example.com/ws",
      },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.customWsEndpoint).toBe(true);
  });

  it("never claims public URL", () => {
    const r = validateWeiboConfig({
      options: { app_id: "1234567890" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.needsPublicUrl).toBe(false);
  });

  it("reports incomplete when only app_id missing format-valid secret path", () => {
    const r = validateWeiboConfig({
      options: { app_id: "1234567890" },
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["app_secret"]);
    expect(r.softStatus).toBe("missing_credentials");
  });
});

describe("weiboHealthHintKeys", () => {
  it("WS hints avoid public-url product callouts", () => {
    const v = validateWeiboConfig({
      options: { app_id: "1234567890" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    const hints = weiboHealthHintKeys(v);
    expect(hints.some((k) => k.includes("weiboWs"))).toBe(true);
    expect(hints.some((k) => k.includes("weiboNoPublicUrl"))).toBe(true);
    expect(hints.some((k) => k.includes("weiboPasteFirst"))).toBe(true);
    expect(hints.some((k) => k.includes("PublicUrl") && k.includes("wecom"))).toBe(
      false,
    );
  });

  it("includes missing keys, custom endpoints, open ACL when asked", () => {
    const v = validateWeiboConfig({
      options: {
        token_endpoint: "https://api.weibo.com/oauth2/access_token",
        ws_endpoint: "wss://api.weibo.com/chat",
      },
      hasCredentials: false,
    });
    const hints = weiboHealthHintKeys(v, { openAcl: true });
    expect(hints.some((k) => k.includes("weiboMissingKeys"))).toBe(true);
    expect(hints.some((k) => k.includes("weiboTokenEndpoint"))).toBe(true);
    expect(hints.some((k) => k.includes("weiboWsEndpoint"))).toBe(true);
    expect(hints.some((k) => k.includes("openAcl"))).toBe(true);
  });

  it("surfaces invalid app_id / endpoints distinctly", () => {
    const badId = validateWeiboConfig({
      options: { app_id: "x" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(
      weiboHealthHintKeys(badId).some((k) => k.includes("weiboAppIdFormat")),
    ).toBe(true);

    const badTok = validateWeiboConfig({
      options: {
        app_id: "1234567890",
        token_endpoint: "nope",
      },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(
      weiboHealthHintKeys(badTok).some((k) =>
        k.includes("weiboTokenEndpointInvalid"),
      ),
    ).toBe(true);

    const badWs = validateWeiboConfig({
      options: {
        app_id: "1234567890",
        ws_endpoint: "bad",
      },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(
      weiboHealthHintKeys(badWs).some((k) =>
        k.includes("weiboWsEndpointInvalid"),
      ),
    ).toBe(true);
  });
});
