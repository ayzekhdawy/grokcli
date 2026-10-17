import { describe, expect, it } from "vitest";
import {
  buildServeClientExamples,
  buildServeConnectionUrl,
  buildServeConnectionUrlMasked,
  looksLikeServeSecretLeak,
  maskServeExampleText,
  maskServeSecret,
  maskServerKeyInUrl,
  parseServeConnectUrl,
  resolveServeProbeTarget,
} from "./serveConnect";

describe("maskServeSecret", () => {
  it("masks short and long values", () => {
    expect(maskServeSecret("")).toBe("");
    expect(maskServeSecret("ab")).toBe("••••");
    expect(maskServeSecret("abcd")).toBe("••••");
    expect(maskServeSecret("abcde")).toBe("••••bcde");
    expect(maskServeSecret("super-secret-token")).toBe("••••oken");
  });
});

describe("maskServerKeyInUrl", () => {
  it("masks server-key and secret query params", () => {
    expect(
      maskServerKeyInUrl("ws://127.0.0.1:2419/ws?server-key=tokensecret99"),
    ).toBe("ws://127.0.0.1:2419/ws?server-key=••••et99");
    expect(maskServerKeyInUrl("ws://h:1/ws?secret=abcdefgh")).toContain(
      "secret=••••",
    );
    expect(maskServerKeyInUrl("ws://h:1/ws")).toBe("ws://h:1/ws");
  });
});

describe("buildServeConnectionUrl", () => {
  it("builds ws URL shape", () => {
    expect(buildServeConnectionUrl("127.0.0.1:2419", "tokensecret99")).toBe(
      "ws://127.0.0.1:2419/ws?server-key=tokensecret99",
    );
    const masked = buildServeConnectionUrlMasked(
      "127.0.0.1:2419",
      "tokensecret99",
    );
    expect(masked).toContain("••••et99");
    expect(masked).not.toContain("tokensecret99");
  });
});

describe("parseServeConnectUrl", () => {
  it("accepts host:port", () => {
    expect(parseServeConnectUrl("127.0.0.1:2419")).toMatchObject({
      ok: true,
      host: "127.0.0.1",
      port: 2419,
      bind: "127.0.0.1:2419",
      hasSecret: false,
    });
  });

  it("parses full ws URL and never returns raw secret", () => {
    const r = parseServeConnectUrl(
      "ws://127.0.0.1:2419/ws?server-key=supersecretTOKEN99",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bind).toBe("127.0.0.1:2419");
    expect(r.port).toBe(2419);
    expect(r.hasSecret).toBe(true);
    expect(r.scheme).toBe("ws");
    expect(r.path).toBe("/ws");
    expect(r.displayUrl).not.toContain("supersecretTOKEN99");
    expect(r.displayUrl).toContain("••••");
    // Result object must not embed full secret as any string field
    expect(JSON.stringify(r)).not.toContain("supersecretTOKEN99");
  });

  it("accepts bracketed IPv6", () => {
    expect(parseServeConnectUrl("[::1]:2419")).toMatchObject({
      ok: true,
      host: "::1",
      port: 2419,
      bind: "[::1]:2419",
    });
  });

  it("strips schemes for probe bind", () => {
    expect(parseServeConnectUrl("wss://agent.example.com:9000/ws")).toMatchObject(
      {
        ok: true,
        bind: "agent.example.com:9000",
        scheme: "wss",
      },
    );
  });

  it("rejects empty / invalid", () => {
    expect(parseServeConnectUrl("")).toEqual({ ok: false, error: "empty" });
    expect(parseServeConnectUrl("localhost")).toEqual({
      ok: false,
      error: "missing_port",
    });
    expect(parseServeConnectUrl(":2419")).toEqual({
      ok: false,
      error: "empty_host",
    });
    expect(parseServeConnectUrl("host:99999")).toEqual({
      ok: false,
      error: "invalid_port",
    });
  });
});

describe("resolveServeProbeTarget", () => {
  it("returns bind only from URL paste", () => {
    expect(
      resolveServeProbeTarget(
        "ws://10.0.0.2:2419/ws?server-key=do-not-send-this",
      ),
    ).toEqual({ ok: true, bind: "10.0.0.2:2419" });
  });
});

describe("buildServeClientExamples", () => {
  it("uses placeholder when secret unknown", () => {
    const ex = buildServeClientExamples({ bind: "127.0.0.1:2419" });
    expect(ex.wsUrl).toContain("<server-key>");
    expect(ex.wsUrlMasked).toContain("server-key=");
    expect(ex.curl).toContain("Upgrade");
    expect(ex.curl).toContain("127.0.0.1:2419");
    expect(ex.websocat).toContain("websocat");
    expect(ex.grokRemote).toContain("--remote");
    expect(ex.grokRemote).toContain("<server-key>");
  });

  it("embeds one-time connection URL when provided", () => {
    const url = "ws://127.0.0.1:2419/ws?server-key=fullSecretValueXYZ";
    const ex = buildServeClientExamples({
      bind: "127.0.0.1:2419",
      connectionUrl: url,
    });
    expect(ex.wsUrl).toBe(url);
    expect(ex.wsUrlMasked).not.toContain("fullSecretValueXYZ");
    expect(ex.curl).toContain("fullSecretValueXYZ");
    expect(ex.grokRemote).toContain("fullSecretValueXYZ");
  });
});

describe("maskServeExampleText", () => {
  it("masks query and --secret flags", () => {
    const text =
      'websocat "ws://h:1/ws?server-key=fullSecretValueXYZ"\ngrok --secret "fullSecretValueXYZ"';
    const masked = maskServeExampleText(text);
    expect(masked).not.toContain("fullSecretValueXYZ");
    expect(masked).toContain("••••");
  });
});

describe("looksLikeServeSecretLeak", () => {
  it("detects long server-key query values", () => {
    expect(
      looksLikeServeSecretLeak(
        "ws://h:1/ws?server-key=abcdefghijklmnopqrstuv",
      ),
    ).toBe(true);
    expect(looksLikeServeSecretLeak("ws://h:1/ws?server-key=••••abcd")).toBe(
      false,
    );
    expect(looksLikeServeSecretLeak("port open")).toBe(false);
  });
});
