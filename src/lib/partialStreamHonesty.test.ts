import { describe, expect, it } from "vitest";
import { PARTIAL_STREAM_MIN_CLI } from "./partialStream";
import {
  classifyPartialStreamError,
  partialStreamApplyEffectMessageKey,
  partialStreamErrorMessageKey,
  resolvePartialStreamApplyEffect,
  resolvePartialStreamBanner,
} from "./partialStreamHonesty";

describe("resolvePartialStreamApplyEffect", () => {
  it("idle_off when toggle is off regardless of CLI / path", () => {
    expect(
      resolvePartialStreamApplyEffect({
        enabled: false,
        cliVersion: "0.2.117",
        isHeadlessPath: true,
      }),
    ).toBe("idle_off");
    expect(
      resolvePartialStreamApplyEffect({
        enabled: null,
        cliVersion: "0.2.112",
        isHeadlessPath: false,
      }),
    ).toBe("idle_off");
    expect(
      resolvePartialStreamApplyEffect({
        enabled: undefined,
        cliVersion: null,
        isHeadlessPath: true,
      }),
    ).toBe("idle_off");
  });

  it("soft_omit when on + older CLI", () => {
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: "0.2.112",
        isHeadlessPath: true,
      }),
    ).toBe("soft_omit");
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: "grok 0.2.100",
        isHeadlessPath: false,
      }),
    ).toBe("soft_omit");
  });

  it("soft_omit when on + unknown / unparseable version", () => {
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: null,
        isHeadlessPath: true,
      }),
    ).toBe("soft_omit");
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: "nope",
        isHeadlessPath: true,
      }),
    ).toBe("soft_omit");
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: "",
        isHeadlessPath: true,
      }),
    ).toBe("soft_omit");
  });

  it("active when on + CLI ≥ 0.2.117 + headless path", () => {
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: "0.2.117",
        isHeadlessPath: true,
      }),
    ).toBe("active");
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: "grok 0.2.120",
        isHeadlessPath: true,
      }),
    ).toBe("active");
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: "1.0.0",
        isHeadlessPath: true,
      }),
    ).toBe("active");
  });

  it("host_only when on + new CLI but not headless (ACP UI chat)", () => {
    expect(
      resolvePartialStreamApplyEffect({
        enabled: true,
        cliVersion: "0.2.117",
        isHeadlessPath: false,
      }),
    ).toBe("host_only");
  });
});

describe("partialStreamApplyEffectMessageKey", () => {
  it("maps effects to stable settings keys", () => {
    expect(partialStreamApplyEffectMessageKey("active")).toBe(
      "settings.includePartialMessages.active",
    );
    expect(partialStreamApplyEffectMessageKey("soft_omit")).toBe(
      "settings.includePartialMessages.softOmit",
    );
    expect(partialStreamApplyEffectMessageKey("idle_off")).toBe(
      "settings.includePartialMessages.idleOff",
    );
    expect(partialStreamApplyEffectMessageKey("host_only")).toBe(
      "settings.includePartialMessages.hostOnly",
    );
  });
});

describe("resolvePartialStreamBanner", () => {
  it("returns null when toggle is off (quiet default)", () => {
    expect(
      resolvePartialStreamBanner({
        enabled: false,
        cliVersion: "0.2.117",
      }),
    ).toBeNull();
  });

  it("soft_omit warn banner when on + old CLI (defaults headless)", () => {
    const b = resolvePartialStreamBanner({
      enabled: true,
      cliVersion: "0.2.112",
    });
    expect(b).not.toBeNull();
    expect(b!.effect).toBe("soft_omit");
    expect(b!.severity).toBe("warn");
    expect(b!.messageKey).toBe("settings.includePartialMessages.softOmit");
    expect(b!.vars.minCli).toBe(PARTIAL_STREAM_MIN_CLI);
  });

  it("active info banner when on + new CLI headless (Settings default)", () => {
    const b = resolvePartialStreamBanner({
      enabled: true,
      cliVersion: "0.2.117",
    });
    expect(b).not.toBeNull();
    expect(b!.effect).toBe("active");
    expect(b!.severity).toBe("info");
    expect(b!.messageKey).toBe("settings.includePartialMessages.active");
    expect(b!.vars.minCli).toBe("0.2.117");
  });

  it("host_only when isHeadlessPath is false", () => {
    const b = resolvePartialStreamBanner({
      enabled: true,
      cliVersion: "0.2.117",
      isHeadlessPath: false,
    });
    expect(b).not.toBeNull();
    expect(b!.effect).toBe("host_only");
    expect(b!.severity).toBe("info");
    expect(b!.messageKey).toBe("settings.includePartialMessages.hostOnly");
  });

  it("soft_omit still wins over non-headless when CLI old", () => {
    const b = resolvePartialStreamBanner({
      enabled: true,
      cliVersion: "0.2.100",
      isHeadlessPath: false,
    });
    expect(b!.effect).toBe("soft_omit");
  });
});

describe("classifyPartialStreamError", () => {
  it("classifies explicit codes", () => {
    expect(classifyPartialStreamError({ code: "cli_too_old" })).toBe(
      "cli_too_old",
    );
    expect(classifyPartialStreamError({ code: "unknown_flag" })).toBe(
      "unknown_flag",
    );
    expect(classifyPartialStreamError({ code: "unsupported_format" })).toBe(
      "unsupported_format",
    );
    expect(classifyPartialStreamError({ code: "need_tauri" })).toBe("host_only");
    expect(classifyPartialStreamError({ code: "host_only" })).toBe("host_only");
  });

  it("classifies unknown flag / clap text for include-partial-messages", () => {
    expect(
      classifyPartialStreamError(
        "error: unexpected argument '--include-partial-messages' found",
      ),
    ).toBe("unknown_flag");
    expect(
      classifyPartialStreamError(
        "unrecognized option: --include-partial-messages",
      ),
    ).toBe("unknown_flag");
  });

  it("classifies CLI too old phrases", () => {
    expect(
      classifyPartialStreamError("CLI_TOO_OLD: grok CLI 0.2.100 < 0.2.117"),
    ).toBe("cli_too_old");
    expect(classifyPartialStreamError("cli version too old for partial")).toBe(
      "cli_too_old",
    );
  });

  it("classifies wrong output-format pairing", () => {
    expect(
      classifyPartialStreamError(
        "--include-partial-messages is only valid with streaming-messages-json",
      ),
    ).toBe("unsupported_format");
    expect(
      classifyPartialStreamError(
        "partial messages not supported with streaming-json",
      ),
    ).toBe("unsupported_format");
  });

  it("classifies host-only phrases", () => {
    expect(classifyPartialStreamError("need tauri")).toBe("host_only");
    expect(classifyPartialStreamError("desktop only feature")).toBe(
      "host_only",
    );
  });

  it("falls back to other", () => {
    expect(classifyPartialStreamError("weird boom")).toBe("other");
    expect(classifyPartialStreamError(null)).toBe("other");
    expect(classifyPartialStreamError("")).toBe("other");
  });
});

describe("partialStreamErrorMessageKey", () => {
  it("maps kinds to stable keys", () => {
    expect(partialStreamErrorMessageKey("cli_too_old")).toBe(
      "settings.includePartialMessages.err.cliTooOld",
    );
    expect(partialStreamErrorMessageKey("unknown_flag")).toBe(
      "settings.includePartialMessages.err.unknownFlag",
    );
    expect(partialStreamErrorMessageKey("unsupported_format")).toBe(
      "settings.includePartialMessages.err.unsupportedFormat",
    );
    expect(partialStreamErrorMessageKey("host_only")).toBe(
      "settings.includePartialMessages.err.hostOnly",
    );
    expect(partialStreamErrorMessageKey("other")).toBe(
      "settings.includePartialMessages.err.other",
    );
  });
});

describe("product matrix", () => {
  const cases: Array<{
    name: string;
    enabled: boolean;
    cli: string | null;
    headless: boolean;
    effect: ReturnType<typeof resolvePartialStreamApplyEffect>;
  }> = [
    {
      name: "off + new CLI headless",
      enabled: false,
      cli: "0.2.117",
      headless: true,
      effect: "idle_off",
    },
    {
      name: "on + old CLI headless → soft_omit",
      enabled: true,
      cli: "0.2.112",
      headless: true,
      effect: "soft_omit",
    },
    {
      name: "on + unknown CLI → soft_omit",
      enabled: true,
      cli: null,
      headless: true,
      effect: "soft_omit",
    },
    {
      name: "on + new CLI headless → active",
      enabled: true,
      cli: "0.2.117",
      headless: true,
      effect: "active",
    },
    {
      name: "on + new CLI ACP UI → host_only",
      enabled: true,
      cli: "0.2.117",
      headless: false,
      effect: "host_only",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        resolvePartialStreamApplyEffect({
          enabled: c.enabled,
          cliVersion: c.cli,
          isHeadlessPath: c.headless,
        }),
      ).toBe(c.effect);
    });
  }
});
