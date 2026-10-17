import { describe, expect, it } from "vitest";
import {
  isQqbotAppIdFormat,
  qqbotHealthHintKeys,
  qqbotIntentsFromOptions,
  qqbotOptionalKeys,
  qqbotRequiredNonSecretKeys,
  qqbotRequiredSecretKeys,
  qqbotSoftStatusMessage,
  validateQqbotConfig,
} from "./qqbotConfig";

describe("isQqbotAppIdFormat", () => {
  it("accepts numeric and alphanumeric AppIDs", () => {
    expect(isQqbotAppIdFormat("102012345")).toBe(true);
    expect(isQqbotAppIdFormat("cli_abc123")).toBe(true);
    expect(isQqbotAppIdFormat("ABC_def-99")).toBe(true);
  });

  it("rejects empty, whitespace, or garbage", () => {
    expect(isQqbotAppIdFormat("")).toBe(false);
    expect(isQqbotAppIdFormat("  ")).toBe(false);
    expect(isQqbotAppIdFormat("ab")).toBe(false);
    expect(isQqbotAppIdFormat("has space")).toBe(false);
    expect(isQqbotAppIdFormat("bad!id")).toBe(false);
  });
});

describe("qqbotIntentsFromOptions", () => {
  it("empty means default (not set)", () => {
    expect(qqbotIntentsFromOptions({})).toEqual({ set: false, raw: "" });
    expect(qqbotIntentsFromOptions({ intents: "  " })).toEqual({
      set: false,
      raw: "",
    });
  });

  it("non-empty intents are custom", () => {
    expect(qqbotIntentsFromOptions({ intents: "INTERACTION" })).toEqual({
      set: true,
      raw: "INTERACTION",
    });
    expect(qqbotIntentsFromOptions({ intents: "33554432" }).set).toBe(true);
  });
});

describe("qqbot required / optional keys", () => {
  it("requires app_id + app_secret; intents optional", () => {
    expect([...qqbotRequiredNonSecretKeys()]).toEqual(["app_id"]);
    expect([...qqbotRequiredSecretKeys()]).toEqual(["app_secret"]);
    expect(qqbotOptionalKeys()).toContain("intents");
    expect(qqbotOptionalKeys()).toContain("allow_from");
  });
});

describe("validateQqbotConfig", () => {
  it("rejects empty form", () => {
    const r = validateQqbotConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("app_id");
    expect(r.missing).toContain("app_secret");
    expect(r.softStatus).toBe("missing_app_id");
    expect(r.transport).toBe("gateway");
    expect(r.intentsSet).toBe(false);
    expect(qqbotSoftStatusMessage(r)).toBe("missing_qqbot_app_id");
  });

  it("missing secret only when app_id present", () => {
    const r = validateQqbotConfig({
      options: { app_id: "102012345" },
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["app_secret"]);
    expect(r.softStatus).toBe("missing_app_secret");
    expect(qqbotSoftStatusMessage(r)).toBe("missing_qqbot_app_secret");
  });

  it("accepts vault credentials without re-pasting secret", () => {
    const r = validateQqbotConfig({
      options: { app_id: "102012345" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_gateway");
    expect(r.intentsSet).toBe(false);
    expect(r.warnings).toContain("intents_default_interaction");
    expect(qqbotSoftStatusMessage(r)).toBe(
      "qqbot_gateway_credentials_present_default_intents",
    );
  });

  it("accepts form secret + app_id", () => {
    const r = validateQqbotConfig({
      options: { app_id: "102012345", intents: "INTERACTION" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_gateway");
    expect(r.intentsSet).toBe(true);
    expect(qqbotSoftStatusMessage(r)).toBe(
      "qqbot_gateway_credentials_present",
    );
  });

  it("accepts secret aliases", () => {
    for (const key of ["app_secret", "appSecret", "client_secret"] as const) {
      const r = validateQqbotConfig({
        options: { app_id: "1020999" },
        secretKeysFilled: new Set([key]),
      });
      expect(r.ok).toBe(true);
    }
  });

  it("invalid app_id format soft-fails", () => {
    const r = validateQqbotConfig({
      options: { app_id: "ab" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_app_id_format");
    expect(r.missing).toContain("app_id");
    expect(qqbotSoftStatusMessage(r)).toBe("invalid_qqbot_app_id_format");
  });

  it("uses appIdValue for format when provided", () => {
    const r = validateQqbotConfig({
      options: {},
      appIdValue: "bad id",
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.softStatus).toBe("invalid_app_id_format");
  });

  it("warns open allow_from in options", () => {
    const r = validateQqbotConfig({
      options: { app_id: "1020", allow_from: "*" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("open_acl");
  });
});

describe("qqbotHealthHintKeys", () => {
  it("always surfaces gateway · not OneBot · default INTERACTION", () => {
    const ready = validateQqbotConfig({
      options: { app_id: "102012345" },
      hasCredentials: true,
    });
    const hints = qqbotHealthHintKeys(ready, { openAcl: true });
    expect(hints.some((k) => k.includes("qqbotGateway"))).toBe(true);
    expect(hints.some((k) => k.includes("qqbotNoWebhook"))).toBe(true);
    expect(hints.some((k) => k.includes("qqbotNotOneBot"))).toBe(true);
    expect(hints.some((k) => k.includes("qqbotIntentsDefault"))).toBe(true);
    expect(hints.some((k) => k.includes("qqbotAcl"))).toBe(true);
  });

  it("missing keys and invalid app id", () => {
    const empty = validateQqbotConfig({ options: {} });
    const h0 = qqbotHealthHintKeys(empty);
    expect(h0.some((k) => k.includes("qqbotMissingAppId"))).toBe(true);

    const noSec = validateQqbotConfig({
      options: { app_id: "102012345" },
    });
    const h1 = qqbotHealthHintKeys(noSec);
    expect(h1.some((k) => k.includes("qqbotMissingSecret"))).toBe(true);

    const bad = validateQqbotConfig({
      options: { app_id: "x" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    const h2 = qqbotHealthHintKeys(bad);
    expect(h2.some((k) => k.includes("qqbotAppIdFormat"))).toBe(true);
  });

  it("custom intents hint when set", () => {
    const v = validateQqbotConfig({
      options: { app_id: "1020", intents: "1<<25" },
      hasCredentials: true,
    });
    const hints = qqbotHealthHintKeys(v);
    expect(hints.some((k) => k.includes("qqbotIntentsCustom"))).toBe(true);
    expect(hints.some((k) => k.includes("qqbotIntentsDefault"))).toBe(false);
  });
});
