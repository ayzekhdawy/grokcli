import { describe, expect, it } from "vitest";
import {
  buildCliTrustDoctorFinding,
  cliTrustChipClass,
  formatCliTrustSummary,
  gradeFromLastInstall,
  gradeFromSetupErrorKind,
  planInstallWithoutChecksum,
  resolveChecksumTrustGrade,
  resolveCliTrustBanner,
  type ChecksumTrustGrade,
} from "./cliTrustSupplyChain";

describe("resolveChecksumTrustGrade", () => {
  it("never invents sidecar — empty opts → unknown", () => {
    expect(resolveChecksumTrustGrade({})).toBe("unknown");
    expect(resolveChecksumTrustGrade({ hasSidecar: null, match: null })).toBe(
      "unknown",
    );
  });

  it("mismatch always wins (fail-closed)", () => {
    expect(
      resolveChecksumTrustGrade({
        match: false,
        hasSidecar: true,
        allowUnverified: true,
        verifiedFlag: true,
      }),
    ).toBe("mismatch");
  });

  it("verified when match or verifiedFlag true", () => {
    expect(
      resolveChecksumTrustGrade({ hasSidecar: true, match: true }),
    ).toBe("verified");
    expect(resolveChecksumTrustGrade({ verifiedFlag: true })).toBe("verified");
  });

  it("missing_sidecar when sidecar absent and no escape hatch", () => {
    expect(
      resolveChecksumTrustGrade({ hasSidecar: false, allowUnverified: false }),
    ).toBe("missing_sidecar");
    expect(
      resolveChecksumTrustGrade({
        verifiedFlag: false,
        allowUnverified: false,
      }),
    ).toBe("missing_sidecar");
  });

  it("unverified_allowed when missing sidecar + allowUnverified", () => {
    expect(
      resolveChecksumTrustGrade({
        hasSidecar: false,
        allowUnverified: true,
      }),
    ).toBe("unverified_allowed");
    expect(
      resolveChecksumTrustGrade({
        verifiedFlag: false,
        allowUnverified: true,
      }),
    ).toBe("unverified_allowed");
  });

  it("hasSidecar true without match stays unknown (no invent verified)", () => {
    expect(resolveChecksumTrustGrade({ hasSidecar: true })).toBe("unknown");
  });
});

describe("resolveCliTrustBanner", () => {
  const grades: ChecksumTrustGrade[] = [
    "verified",
    "missing_sidecar",
    "mismatch",
    "unverified_allowed",
    "unknown",
  ];

  it("maps every grade to titleKey + severity warn|error|ok", () => {
    for (const g of grades) {
      const b = resolveCliTrustBanner(g);
      expect(b.titleKey.startsWith("cliTrust.")).toBe(true);
      expect(["ok", "warn", "error"]).toContain(b.severity);
    }
  });

  it("verified is ok; mismatch is error; missing is warn", () => {
    expect(resolveCliTrustBanner("verified").severity).toBe("ok");
    expect(resolveCliTrustBanner("mismatch").severity).toBe("error");
    expect(resolveCliTrustBanner("missing_sidecar").severity).toBe("warn");
    expect(resolveCliTrustBanner("unverified_allowed").severity).toBe("warn");
  });

  it("mismatch hint stresses fail-closed", () => {
    const b = resolveCliTrustBanner("mismatch");
    expect(b.hintKey).toBe("cliTrust.hint.mismatch");
    expect(b.titleKey).toBe("cliTrust.grade.mismatch");
  });
});

describe("planInstallWithoutChecksum", () => {
  it("allows missing sidecar by default", () => {
    expect(
      planInstallWithoutChecksum({
        requireChecksum: false,
        allowUnverified: false,
      }),
    ).toBe("allow");
  });

  it("refuses when requireChecksum without allowUnverified", () => {
    expect(
      planInstallWithoutChecksum({
        requireChecksum: true,
        allowUnverified: false,
      }),
    ).toBe("refuse_need_flag");
  });

  it("allows strict mode when allowUnverified is set", () => {
    expect(
      planInstallWithoutChecksum({
        requireChecksum: true,
        allowUnverified: true,
      }),
    ).toBe("allow");
  });

  it("mismatch always refuse_mismatch (never forceable)", () => {
    expect(
      planInstallWithoutChecksum({
        requireChecksum: false,
        allowUnverified: true,
        match: false,
      }),
    ).toBe("refuse_mismatch");
  });
});

describe("formatCliTrustSummary", () => {
  it("includes grade and redacts mirror to host", () => {
    const s = formatCliTrustSummary({
      grade: "missing_sidecar",
      version: "0.2.3",
      mirror: "https://user:secret@storage.googleapis.com/grok-build/path",
    });
    expect(s).toContain("CLI trust: missing_sidecar");
    expect(s).toContain("version 0.2.3");
    expect(s).toContain("mirror storage.googleapis.com");
    expect(s).not.toContain("secret");
    expect(s).not.toContain("user:");
  });

  it("omits empty version / mirror", () => {
    expect(formatCliTrustSummary({ grade: "verified" })).toBe(
      "CLI trust: verified",
    );
  });
});

describe("cliTrustChipClass / grade helpers", () => {
  it("chip classes use ext-badge tokens", () => {
    expect(cliTrustChipClass("ok")).toContain("ext-badge--ok");
    expect(cliTrustChipClass("warn")).toContain("ext-badge--warn");
    expect(cliTrustChipClass("error")).toContain("ext-badge--fail");
  });

  it("gradeFromSetupErrorKind only for checksum kinds", () => {
    expect(gradeFromSetupErrorKind("checksum_missing")).toBe("missing_sidecar");
    expect(gradeFromSetupErrorKind("checksum_mismatch")).toBe("mismatch");
    expect(gradeFromSetupErrorKind("network")).toBeNull();
    expect(gradeFromSetupErrorKind(null)).toBeNull();
  });

  it("gradeFromLastInstall maps settings flag", () => {
    expect(
      gradeFromLastInstall({ lastCliChecksumVerified: true }),
    ).toBe("verified");
    expect(
      gradeFromLastInstall({
        lastCliChecksumVerified: false,
        allowUnverified: false,
      }),
    ).toBe("missing_sidecar");
    expect(
      gradeFromLastInstall({
        lastCliChecksumVerified: false,
        allowUnverified: true,
      }),
    ).toBe("unverified_allowed");
    expect(gradeFromLastInstall({})).toBe("unknown");
  });
});

describe("buildCliTrustDoctorFinding", () => {
  it("skips unknown; returns honest levels for known grades", () => {
    expect(buildCliTrustDoctorFinding("unknown")).toBeNull();
    const ok = buildCliTrustDoctorFinding("verified");
    expect(ok?.level).toBe("ok");
    expect(ok?.id).toBe("cli_checksum_trust");
    const fail = buildCliTrustDoctorFinding("mismatch");
    expect(fail?.level).toBe("fail");
    const warn = buildCliTrustDoctorFinding("missing_sidecar");
    expect(warn?.level).toBe("warn");
    expect(warn?.summary).toContain("missing_sidecar");
  });
});
