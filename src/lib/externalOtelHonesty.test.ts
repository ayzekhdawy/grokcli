import { describe, expect, it } from "vitest";
import {
  buildExternalOtelChecklist,
  evidenceFromExternalOtelConfigText,
  evidenceFromExternalOtelEnv,
  externalOtelClaimsOff,
  externalOtelSharedModeNoteKey,
  externalOtelStatusMessageKey,
  externalOtelStatusTone,
  externalOtelToneClass,
  formatExternalOtelEnvHints,
  isActiveOtelExporter,
  mergeExternalOtelEvidence,
  parseExternalOtelMasterValue,
  resolveExternalOtelStatus,
  EXTERNAL_OTEL_HEADERS_ENV,
  EXTERNAL_OTEL_MASTER_ENV,
} from "./externalOtelHonesty";

describe("parseExternalOtelMasterValue", () => {
  it("parses truthy / falsy / empty without inventing off for empty", () => {
    expect(parseExternalOtelMasterValue("1")).toBe(true);
    expect(parseExternalOtelMasterValue("true")).toBe(true);
    expect(parseExternalOtelMasterValue("YES")).toBe(true);
    expect(parseExternalOtelMasterValue("0")).toBe(false);
    expect(parseExternalOtelMasterValue("false")).toBe(false);
    expect(parseExternalOtelMasterValue("off")).toBe(false);
    expect(parseExternalOtelMasterValue("")).toBeNull();
    expect(parseExternalOtelMasterValue(null)).toBeNull();
    expect(parseExternalOtelMasterValue(undefined)).toBeNull();
    expect(parseExternalOtelMasterValue("maybe")).toBeNull();
  });
});

describe("isActiveOtelExporter", () => {
  it("treats otlp/console as active, none as false, empty as unset", () => {
    expect(isActiveOtelExporter("otlp")).toBe(true);
    expect(isActiveOtelExporter("console")).toBe(true);
    expect(isActiveOtelExporter("none")).toBe(false);
    expect(isActiveOtelExporter("")).toBeNull();
    expect(isActiveOtelExporter(null)).toBeNull();
  });
});

describe("resolveExternalOtelStatus — dual opt-in", () => {
  it("never invents off when unset", () => {
    expect(resolveExternalOtelStatus({})).toBe("unknown");
    expect(resolveExternalOtelStatus({ masterEnv: null })).toBe("unknown");
    expect(
      resolveExternalOtelStatus({
        masterEnv: null,
        exportersConfigured: null,
        configPresent: null,
      }),
    ).toBe("unknown");
    expect(externalOtelClaimsOff("unknown")).toBe(false);
  });

  it("ready only when master AND exporter", () => {
    expect(
      resolveExternalOtelStatus({
        masterEnv: true,
        exportersConfigured: true,
      }),
    ).toBe("ready");
    expect(externalOtelClaimsOff("ready")).toBe(false);
  });

  it("incomplete when only master or only exporter", () => {
    expect(
      resolveExternalOtelStatus({
        masterEnv: true,
        exportersConfigured: false,
      }),
    ).toBe("incomplete");
    expect(
      resolveExternalOtelStatus({
        masterEnv: true,
        exportersConfigured: null,
      }),
    ).toBe("incomplete");
    expect(
      resolveExternalOtelStatus({
        masterEnv: false,
        exportersConfigured: true,
      }),
    ).toBe("incomplete");
    expect(
      resolveExternalOtelStatus({
        masterEnv: null,
        exportersConfigured: true,
      }),
    ).toBe("incomplete");
  });

  it("off only when master explicitly false (and no active exporter)", () => {
    expect(
      resolveExternalOtelStatus({
        masterEnv: false,
        exportersConfigured: false,
      }),
    ).toBe("off");
    expect(
      resolveExternalOtelStatus({
        masterEnv: false,
        exportersConfigured: null,
      }),
    ).toBe("off");
    expect(externalOtelClaimsOff("off")).toBe(true);
  });

  it("host_only when available is false", () => {
    expect(
      resolveExternalOtelStatus({
        available: false,
        masterEnv: true,
        exportersConfigured: true,
      }),
    ).toBe("host_only");
  });

  it("configPresent alone does not claim off or ready", () => {
    expect(
      resolveExternalOtelStatus({
        configPresent: true,
        masterEnv: null,
        exportersConfigured: null,
      }),
    ).toBe("unknown");
    expect(
      resolveExternalOtelStatus({
        configPresent: false,
      }),
    ).toBe("unknown");
  });
});

describe("evidenceFromExternalOtelEnv", () => {
  it("maps dual opt-in env without inventing missing keys", () => {
    expect(evidenceFromExternalOtelEnv({})).toEqual({
      masterEnv: null,
      exportersConfigured: null,
      configPresent: null,
    });
    expect(evidenceFromExternalOtelEnv(null)).toEqual({
      masterEnv: null,
      exportersConfigured: null,
      configPresent: null,
    });

    const ready = evidenceFromExternalOtelEnv({
      [EXTERNAL_OTEL_MASTER_ENV]: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "none",
    });
    expect(ready.masterEnv).toBe(true);
    expect(ready.exportersConfigured).toBe(true);
    expect(ready.configPresent).toBe(true);
    expect(resolveExternalOtelStatus(ready)).toBe("ready");

    const masterOnly = evidenceFromExternalOtelEnv({
      [EXTERNAL_OTEL_MASTER_ENV]: "1",
    });
    expect(masterOnly.masterEnv).toBe(true);
    expect(masterOnly.exportersConfigured).toBeNull();
    expect(resolveExternalOtelStatus(masterOnly)).toBe("incomplete");

    const exporterOnly = evidenceFromExternalOtelEnv({
      OTEL_LOGS_EXPORTER: "console",
    });
    expect(exporterOnly.masterEnv).toBeNull();
    expect(exporterOnly.exportersConfigured).toBe(true);
    expect(resolveExternalOtelStatus(exporterOnly)).toBe("incomplete");

    const off = evidenceFromExternalOtelEnv({
      [EXTERNAL_OTEL_MASTER_ENV]: "0",
      OTEL_METRICS_EXPORTER: "none",
    });
    expect(off.masterEnv).toBe(false);
    expect(off.exportersConfigured).toBe(false);
    expect(resolveExternalOtelStatus(off)).toBe("off");
  });
});

describe("evidenceFromExternalOtelConfigText", () => {
  it("soft-parses otel_* peers; empty stays unknown", () => {
    expect(evidenceFromExternalOtelConfigText("")).toEqual({
      masterEnv: null,
      exportersConfigured: null,
      configPresent: null,
    });
    expect(evidenceFromExternalOtelConfigText("# no otel keys")).toEqual({
      masterEnv: null,
      exportersConfigured: null,
      configPresent: null,
    });

    const toml = `
[telemetry]
otel_enabled = true
otel_metrics_exporter = "otlp"
otel_logs_exporter = "none"
otel_endpoint = "https://collector.example:4318"
`;
    const e = evidenceFromExternalOtelConfigText(toml);
    expect(e.masterEnv).toBe(true);
    expect(e.exportersConfigured).toBe(true);
    expect(e.configPresent).toBe(true);
    expect(resolveExternalOtelStatus(e)).toBe("ready");

    const disabled = evidenceFromExternalOtelConfigText(
      "otel_enabled = false\notel_metrics_exporter = none\n",
    );
    expect(disabled.masterEnv).toBe(false);
    expect(disabled.exportersConfigured).toBe(false);
    expect(resolveExternalOtelStatus(disabled)).toBe("off");
  });
});

describe("mergeExternalOtelEvidence", () => {
  it("merges env + config with true winning for dual opt-in halves", () => {
    const merged = mergeExternalOtelEvidence(
      { masterEnv: true, exportersConfigured: null },
      { masterEnv: null, exportersConfigured: true },
    );
    expect(merged.masterEnv).toBe(true);
    expect(merged.exportersConfigured).toBe(true);
    expect(resolveExternalOtelStatus(merged)).toBe("ready");

    const host = mergeExternalOtelEvidence(
      { masterEnv: true, exportersConfigured: true },
      { available: false },
    );
    expect(resolveExternalOtelStatus(host)).toBe("host_only");
  });
});

describe("buildExternalOtelChecklist", () => {
  it("exposes dual opt-in steps with honest done flags", () => {
    const unset = buildExternalOtelChecklist({});
    expect(unset.map((s) => s.id)).toEqual([
      "master",
      "exporter",
      "content_free",
      "no_app_secrets",
      "independent_stream",
    ]);
    expect(unset.find((s) => s.id === "master")?.done).toBeNull();
    expect(unset.find((s) => s.id === "exporter")?.done).toBeNull();
    expect(unset.find((s) => s.id === "content_free")?.done).toBe(true);
    expect(unset.find((s) => s.id === "no_app_secrets")?.done).toBe(true);

    const ready = buildExternalOtelChecklist({
      masterEnv: true,
      exportersConfigured: true,
    });
    expect(ready.find((s) => s.id === "master")?.done).toBe(true);
    expect(ready.find((s) => s.id === "exporter")?.done).toBe(true);

    const partial = buildExternalOtelChecklist({
      masterEnv: true,
      exportersConfigured: false,
    });
    expect(partial.find((s) => s.id === "exporter")?.done).toBe(false);
  });
});

describe("formatExternalOtelEnvHints", () => {
  it("documents env vars with redacted placeholders (no secrets)", () => {
    const text = formatExternalOtelEnvHints();
    expect(text).toContain(EXTERNAL_OTEL_MASTER_ENV);
    expect(text).toContain("OTEL_METRICS_EXPORTER");
    expect(text).toContain("OTEL_LOGS_EXPORTER");
    expect(text).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(text).toContain(EXTERNAL_OTEL_HEADERS_ENV);
    expect(text).toContain("<REDACTED>");
    expect(text).not.toMatch(/sk-[a-zA-Z0-9]/);
    expect(text).not.toMatch(/Bearer [A-Za-z0-9._-]{8,}/);
    expect(text.toLowerCase()).toContain("dual opt-in");
    expect(text.toLowerCase()).toContain("content-free");
  });
});

describe("status message keys / tone", () => {
  it("maps every status to a stable key and tone class", () => {
    const statuses = [
      "off",
      "incomplete",
      "ready",
      "unknown",
      "host_only",
    ] as const;
    for (const s of statuses) {
      const key = externalOtelStatusMessageKey(s);
      expect(key.startsWith("settings.privacy.externalOtel.status.")).toBe(
        true,
      );
      const tone = externalOtelStatusTone(s);
      expect(["ok", "warn", "info", "muted", "err"]).toContain(tone);
      expect(externalOtelToneClass(tone)).toMatch(/^is-/);
    }
    expect(externalOtelSharedModeNoteKey()).toBe(
      "settings.privacy.externalOtel.sharedNote",
    );
  });
});
