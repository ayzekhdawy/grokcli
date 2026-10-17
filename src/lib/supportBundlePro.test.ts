import { describe, expect, it } from "vitest";
import {
  SUPPORT_BUNDLE_SECTION_ORDER,
  canSupportBundleExport,
  classifySupportBundleError,
  formatSupportBundleManifest,
  planSupportBundleExport,
  resolveSupportBundleEmptyState,
  resolveSupportBundleSoftFail,
  resolveSupportBundleStallJson,
  supportBundleErrorMessageKey,
  supportBundleSectionHintKey,
  supportBundleSectionLabelKey,
  supportBundleSoftFailSilent,
} from "./supportBundlePro";

describe("planSupportBundleExport", () => {
  it("always includes doctor, settings, meta, logs, readme; never secrets", () => {
    const plan = planSupportBundleExport({
      hasDoctor: false,
      hasStallTimeline: false,
    });
    expect(plan.secretsIncluded).toBe(false);
    expect(plan.auditIncluded).toBe(false);
    expect(plan.includedIds).toContain("doctor");
    expect(plan.includedIds).toContain("settings");
    expect(plan.includedIds).toContain("meta");
    expect(plan.includedIds).toContain("logs");
    expect(plan.includedIds).toContain("readme");
    expect(plan.includedIds).not.toContain("stall_timeline");
    expect(plan.hasStallTimeline).toBe(false);
    expect(plan.hasDoctor).toBe(false);
    expect(plan.canExport).toBe(true);
  });

  it("includes stall timeline only when hasStallTimeline", () => {
    const off = planSupportBundleExport({
      hasDoctor: true,
      hasStallTimeline: false,
    });
    const on = planSupportBundleExport({
      hasDoctor: true,
      hasStallTimeline: true,
    });
    expect(off.sections.find((s) => s.id === "stall_timeline")?.included).toBe(
      false,
    );
    expect(on.sections.find((s) => s.id === "stall_timeline")?.included).toBe(
      true,
    );
    expect(on.includedIds).toContain("stall_timeline");
    expect(on.hasStallTimeline).toBe(true);
  });

  it("never claims audit in the zip; marks auditOmitted when hasAudit", () => {
    const plan = planSupportBundleExport({
      hasDoctor: true,
      hasStallTimeline: false,
      hasAudit: true,
    });
    expect(plan.auditIncluded).toBe(false);
    expect(plan.auditOmitted).toBe(true);
    expect(plan.sections.some((s) => (s.id as string) === "audit")).toBe(false);
  });

  it("canExport false when isHost is false", () => {
    const plan = planSupportBundleExport({
      hasDoctor: true,
      hasStallTimeline: true,
      isHost: false,
    });
    expect(plan.canExport).toBe(false);
  });

  it("marks settings/logs as when_available (never invent files)", () => {
    const plan = planSupportBundleExport({
      hasDoctor: true,
      hasStallTimeline: false,
    });
    expect(plan.sections.find((s) => s.id === "settings")?.availability).toBe(
      "when_available",
    );
    expect(plan.sections.find((s) => s.id === "logs")?.availability).toBe(
      "when_available",
    );
    expect(plan.sections.find((s) => s.id === "doctor")?.redacted).toBe(true);
    expect(plan.sections.find((s) => s.id === "logs")?.redacted).toBe(true);
  });

  it("uses stable section order", () => {
    const plan = planSupportBundleExport({
      hasDoctor: true,
      hasStallTimeline: true,
    });
    expect(plan.sections.map((s) => s.id)).toEqual([
      ...SUPPORT_BUNDLE_SECTION_ORDER,
    ]);
  });
});

describe("resolveSupportBundleEmptyState", () => {
  it("returns host_only when not on desktop host", () => {
    const empty = resolveSupportBundleEmptyState({ isHost: false });
    expect(empty?.kind).toBe("host_only");
    expect(empty?.titleKey).toBe("reliability.supportZip.emptyHostOnly");
    expect(empty?.hintKey).toBe("reliability.supportZip.emptyHostOnlyHint");
  });

  it("returns null on host (base zip always possible)", () => {
    expect(
      resolveSupportBundleEmptyState({
        isHost: true,
        hasDoctor: false,
        hasStallTimeline: false,
      }),
    ).toBeNull();
  });
});

describe("formatSupportBundleManifest", () => {
  it("lists included sections and never claims secrets", () => {
    const plan = planSupportBundleExport({
      hasDoctor: true,
      hasStallTimeline: true,
      hasAudit: true,
    });
    const text = formatSupportBundleManifest(plan);
    expect(text).toContain("# Support bundle preview (redacted)");
    expect(text).toContain("Secrets are never included");
    expect(text).toContain("[x] doctor.json");
    expect(text).toContain("[x] stall-timeline.json");
    expect(text).toContain("if present on host");
    expect(text).toContain("Never included: secrets.json");
    expect(text).toContain("Tool audit ledger is not in this zip");
    expect(text.toLowerCase()).not.toContain("secrets.json is included");
    expect(text).not.toMatch(/logs\/[a-z0-9_-]+\.log/i);
  });

  it("marks omitted stall honestly", () => {
    const plan = planSupportBundleExport({
      hasDoctor: false,
      hasStallTimeline: false,
    });
    const text = formatSupportBundleManifest(plan.sections);
    expect(text).toContain("[ ] stall-timeline.json");
    expect(text).toContain("not included this export");
  });

  it("handles empty input without inventing sections", () => {
    const text = formatSupportBundleManifest(null);
    expect(text).toContain("(no sections planned)");
    expect(text).toContain("Secrets are never included");
  });
});

describe("classifySupportBundleError", () => {
  it("classifies host_only", () => {
    expect(classifySupportBundleError("Tauri required: export_support_bundle")).toBe(
      "host_only",
    );
    expect(classifySupportBundleError("need tauri")).toBe("host_only");
    expect(classifySupportBundleError({ code: "host_only" })).toBe("host_only");
    expect(classifySupportBundleError("desktop only")).toBe("host_only");
  });

  it("classifies cancel", () => {
    expect(classifySupportBundleError("user cancelled")).toBe("cancel");
    expect(classifySupportBundleError("User canceled")).toBe("cancel");
    expect(classifySupportBundleError({ code: "cancelled" })).toBe("cancel");
    expect(classifySupportBundleError("dismissed")).toBe("cancel");
  });

  it("classifies io", () => {
    expect(classifySupportBundleError("create zip: permission denied")).toBe(
      "io",
    );
    expect(classifySupportBundleError("copy archive: disk full")).toBe("io");
    expect(classifySupportBundleError({ code: "enospc" })).toBe("io");
    expect(classifySupportBundleError("finish zip: i/o error")).toBe("io");
  });

  it("classifies empty", () => {
    expect(classifySupportBundleError("empty")).toBe("empty");
    expect(classifySupportBundleError("nothing to export")).toBe("empty");
    expect(classifySupportBundleError({ code: "empty" })).toBe("empty");
  });

  it("falls back to other", () => {
    expect(classifySupportBundleError("something weird")).toBe("other");
    expect(classifySupportBundleError(null)).toBe("other");
    expect(classifySupportBundleError("")).toBe("other");
  });
});

describe("soft-fail helpers", () => {
  it("maps kinds to i18n keys", () => {
    expect(supportBundleErrorMessageKey("host_only")).toBe(
      "reliability.supportZip.failHostOnly",
    );
    expect(supportBundleErrorMessageKey("cancel")).toBe(
      "reliability.supportZip.failCancel",
    );
    expect(supportBundleErrorMessageKey("io")).toBe(
      "reliability.supportZip.failIo",
    );
    expect(supportBundleErrorMessageKey("empty")).toBe(
      "reliability.supportZip.failEmpty",
    );
    expect(supportBundleErrorMessageKey("other")).toBe("doctor.supportZipFail");
  });

  it("cancel is silent; others are not", () => {
    expect(supportBundleSoftFailSilent("cancel")).toBe(true);
    expect(supportBundleSoftFailSilent("io")).toBe(false);
    expect(supportBundleSoftFailSilent("host_only")).toBe(false);
  });

  it("resolveSupportBundleSoftFail returns detail only for other", () => {
    const cancel = resolveSupportBundleSoftFail("user cancelled");
    expect(cancel.kind).toBe("cancel");
    expect(cancel.silent).toBe(true);
    expect(cancel.detail).toBe("");

    const other = resolveSupportBundleSoftFail(new Error("boom detail"));
    expect(other.kind).toBe("other");
    expect(other.silent).toBe(false);
    expect(other.detail).toContain("boom detail");
    expect(other.messageKey).toBe("doctor.supportZipFail");
  });
});

describe("section label keys", () => {
  it("returns stable i18n keys for every section id", () => {
    for (const id of SUPPORT_BUNDLE_SECTION_ORDER) {
      expect(supportBundleSectionLabelKey(id)).toMatch(
        /^reliability\.supportZip\.section\./,
      );
      expect(supportBundleSectionHintKey(id)).toMatch(
        /^reliability\.supportZip\.section\./,
      );
    }
  });
});

describe("canSupportBundleExport / resolveSupportBundleStallJson", () => {
  it("requires host and not busy", () => {
    expect(canSupportBundleExport({ isHost: true })).toBe(true);
    expect(canSupportBundleExport({ isHost: false })).toBe(false);
    expect(canSupportBundleExport({ isHost: true, busy: true })).toBe(false);
  });

  it("only returns stall JSON when planned and non-empty", () => {
    expect(
      resolveSupportBundleStallJson({
        hasStallTimeline: false,
        stallJson: '{"count":1}',
      }),
    ).toBeNull();
    expect(
      resolveSupportBundleStallJson({
        hasStallTimeline: true,
        stallJson: "   ",
      }),
    ).toBeNull();
    expect(
      resolveSupportBundleStallJson({
        hasStallTimeline: true,
        stallJson: '{"count":0}',
        signalCount: 0,
      }),
    ).toBeNull();
    expect(
      resolveSupportBundleStallJson({
        hasStallTimeline: true,
        stallJson: '{"count":2}',
        signalCount: 2,
      }),
    ).toBe('{"count":2}');
  });
});
