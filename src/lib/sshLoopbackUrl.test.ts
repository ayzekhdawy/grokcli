import { describe, expect, it } from "vitest";
import {
  isLoopbackHttpHost,
  isLoopbackHttpUrl,
  normalizeBrowserUrl,
  parseLoopbackHttpUrl,
  rewriteLoopbackUrl,
} from "./sshLoopbackUrl";

describe("isLoopbackHttpHost", () => {
  it("accepts loopback spellings", () => {
    expect(isLoopbackHttpHost("localhost")).toBe(true);
    expect(isLoopbackHttpHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHttpHost("[::1]")).toBe(true);
    expect(isLoopbackHttpHost("::1")).toBe(true);
    expect(isLoopbackHttpHost("0.0.0.0")).toBe(true);
    expect(isLoopbackHttpHost("app.localhost")).toBe(true);
    expect(isLoopbackHttpHost("example.com")).toBe(false);
    expect(isLoopbackHttpHost("10.0.0.8")).toBe(false);
  });
});

describe("parseLoopbackHttpUrl / rewrite", () => {
  it("parses localhost with path and query", () => {
    const t = parseLoopbackHttpUrl("http://localhost:5173/app?x=1#h");
    expect(t).toEqual({
      scheme: "http",
      host: "localhost",
      port: 5173,
      rest: "/app?x=1#h",
    });
    expect(rewriteLoopbackUrl("http://localhost:5173/app?x=1#h", 49152)).toBe(
      "http://127.0.0.1:49152/app?x=1#h",
    );
  });

  it("rejects public hosts", () => {
    expect(isLoopbackHttpUrl("https://www.google.com")).toBe(false);
    expect(parseLoopbackHttpUrl("https://github.com")).toBeNull();
    expect(rewriteLoopbackUrl("https://github.com", 9)).toBeNull();
  });

  it("defaults http/https ports", () => {
    expect(parseLoopbackHttpUrl("http://localhost/x")?.port).toBe(80);
    expect(parseLoopbackHttpUrl("https://127.0.0.1/x")?.port).toBe(443);
  });
});

describe("normalizeBrowserUrl", () => {
  it("keeps an explicit scheme", () => {
    expect(normalizeBrowserUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(normalizeBrowserUrl("https://example.com")).toBe(
      "https://example.com",
    );
  });

  it("uses http for bare loopback on SSH projects", () => {
    expect(
      normalizeBrowserUrl("localhost:3000", { preferHttpLoopback: true }),
    ).toBe("http://localhost:3000");
    expect(
      normalizeBrowserUrl("127.0.0.1:8080/health", {
        preferHttpLoopback: true,
      }),
    ).toBe("http://127.0.0.1:8080/health");
    expect(
      normalizeBrowserUrl("example.com", { preferHttpLoopback: true }),
    ).toBe("https://example.com");
  });

  it("defaults bare hosts to https without the SSH flag", () => {
    expect(normalizeBrowserUrl("localhost:3000")).toBe(
      "https://localhost:3000",
    );
  });
});
