import { describe, expect, it } from "vitest";
import {
  classifyMcpOauthFinding,
  classifyMcpOauthFromStatus,
  classifyMcpOauthSource,
  extractMcpAuthUrls,
  isMcpOauthText,
  mcpOauthActionKind,
  mcpOauthActionLabelKey,
  planMcpOauthOpen,
  redactMcpOauthText,
  sanitizeMcpAuthUrl,
} from "./mcpOauth";
import type { McpServerStatus } from "./mcpStatus";

describe("isMcpOauthText", () => {
  it("detects OAuth authorization required wording", () => {
    expect(
      isMcpOauthText(
        "Auth error: OAuth authorization required, when send initialize request",
      ),
    ).toBe(true);
    expect(isMcpOauthText("AuthorizationRequired")).toBe(true);
    expect(
      isMcpOauthText(
        'resource_metadata="https://builds.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"',
      ),
    ).toBe(true);
  });

  it("detects oauth failure tokens", () => {
    expect(isMcpOauthText("invalid_token for oauth client")).toBe(true);
    expect(isMcpOauthText("oauth failed during handshake")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isMcpOauthText("connection refused")).toBe(false);
    expect(isMcpOauthText("")).toBe(false);
    expect(isMcpOauthText(null)).toBe(false);
  });
});

describe("sanitizeMcpAuthUrl / extractMcpAuthUrls", () => {
  it("keeps clean authorize URLs", () => {
    const u =
      "https://auth.example.com/oauth/authorize?client_id=abc&response_type=code";
    expect(sanitizeMcpAuthUrl(u)).toBe(u);
  });

  it("strips secret query params and never returns userinfo credentials", () => {
    const dirty =
      "https://auth.example.com/callback?code=SECRETCODE&state=ok&access_token=tok123";
    const clean = sanitizeMcpAuthUrl(dirty);
    expect(clean).toBeTruthy();
    expect(clean).not.toContain("SECRETCODE");
    expect(clean).not.toContain("tok123");
    expect(clean).not.toContain("access_token");
    expect(clean).toContain("state=ok");

    expect(sanitizeMcpAuthUrl("https://user:pass@evil.example/oauth")).toBeNull();
    expect(sanitizeMcpAuthUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeMcpAuthUrl("ftp://example.com")).toBeNull();
  });

  it("extracts and ranks auth-related URLs from doctor prose", () => {
    const text = [
      "AuthRequiredError resource_metadata=",
      '"https://builds.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"',
      " also see https://example.com/mcp/tools (ignore)",
      " authorize at https://login.example.com/oauth/authorize?client_id=x",
      " and token= https://evil.example/cb?access_token=supersecrettokenvalue",
    ].join(" ");
    const urls = extractMcpAuthUrls(text);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls[0]).toMatch(/authorize/i);
    expect(urls.some((u) => u.includes("well-known"))).toBe(true);
    expect(urls.join(" ")).not.toContain("supersecrettokenvalue");
    // Non-auth MCP tool path should not rank first (may be filtered out).
    expect(urls[0]).not.toMatch(/\/mcp\/tools/);
  });
});

describe("mcpOauthActionKind / classify", () => {
  it("maps expired oauth to retry", () => {
    expect(mcpOauthActionKind("OAuth token expired", "auth_expired")).toBe(
      "retry",
    );
    expect(
      classifyMcpOauthSource({
        detail: "invalid_token — access token expired",
        server: "github",
      })?.kind,
    ).toBe("retry");
  });

  it("maps oauth required to authorize", () => {
    expect(
      mcpOauthActionKind("OAuth authorization required", "auth_required"),
    ).toBe("authorize");
    const action = classifyMcpOauthSource({
      title: "handshake failed",
      detail:
        "Auth error: OAuth authorization required, when send initialize request",
      server: "cloudflare-api",
    });
    expect(action?.kind).toBe("authorize");
    expect(action?.server).toBe("cloudflare-api");
    expect(action?.isRetry).toBe(false);
  });

  it("classifies doctor findings; ignores ok rows", () => {
    expect(
      classifyMcpOauthFinding({
        id: "1",
        level: "ok",
        title: "server started",
        detail: "",
        server: "x",
      }),
    ).toBeNull();

    const fail = classifyMcpOauthFinding({
      id: "2",
      level: "fail",
      title: "handshake failed",
      detail:
        'AuthRequired (resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource")',
      server: "lin",
    });
    expect(fail?.kind).toBe("authorize");
    expect(fail?.preferredUrl).toMatch(/well-known/);
  });

  it("classifies from McpServerStatus", () => {
    const st: McpServerStatus = {
      name: "github",
      tone: "auth_expired",
      reason: "401 Unauthorized — token expired",
      needsAuthRefresh: true,
      issues: ["OAuth token expired for github"],
      healthy: false,
    };
    const action = classifyMcpOauthFromStatus(st);
    expect(action?.kind).toBe("retry");
    expect(action?.server).toBe("github");
  });

  it("returns null for non-auth status", () => {
    expect(
      classifyMcpOauthFromStatus({
        name: "broken",
        tone: "error",
        reason: "connection refused",
        needsAuthRefresh: false,
        issues: ["connection refused"],
        healthy: false,
      }),
    ).toBeNull();
  });
});

describe("planMcpOauthOpen", () => {
  it("prefers opening a sanitized URL", () => {
    const action = classifyMcpOauthSource({
      detail:
        "authorize at https://login.example.com/oauth/authorize?client_id=app",
      tone: "auth_required",
    });
    const plan = planMcpOauthOpen(action);
    expect(plan).toEqual({
      mode: "open_url",
      url: "https://login.example.com/oauth/authorize?client_id=app",
      kind: "authorize",
    });
  });

  it("falls back to instructions when no URL (no CLI helper)", () => {
    const action = classifyMcpOauthSource({
      detail: "OAuth authorization required",
      tone: "auth_required",
      server: "x",
    });
    expect(planMcpOauthOpen(action)).toEqual({
      mode: "instructions",
      kind: "authorize",
      reason: "no_cli_helper",
    });
  });

  it("returns null for null action", () => {
    expect(planMcpOauthOpen(null)).toBeNull();
  });
});

describe("labels / redact", () => {
  it("maps action kinds to i18n keys", () => {
    expect(mcpOauthActionLabelKey("authorize")).toBe(
      "mcpModal.oauth.authorize",
    );
    expect(mcpOauthActionLabelKey("retry")).toBe("mcpModal.oauth.retry");
  });

  it("redacts tokens from free text", () => {
    const out = redactMcpOauthText(
      "failed Bearer abcdefghijklmnop and GITHUB_TOKEN=ghs_secretvalue99",
    );
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).not.toContain("ghs_secretvalue99");
    expect(out).toContain("[REDACTED]");
  });
});
