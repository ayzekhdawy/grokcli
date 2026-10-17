import { describe, expect, it } from "vitest";
import {
  MIRROR_DEFAULT_MAX_CLIENTS,
  MIRROR_MAX_CLIENTS_CAP,
  MIRROR_MIN_CLIENTS,
  clampMirrorMaxClients,
  formatMirrorClientCapLine,
  mirrorClientCapKindHintKey,
  mirrorClientCapKindLabelKey,
  mirrorClientCapToneClass,
  resolveMirrorCapEmptyState,
  resolveMirrorClientCapState,
} from "./mirrorClientCapPro";

describe("clampMirrorMaxClients", () => {
  it("defaults for non-finite / missing", () => {
    expect(clampMirrorMaxClients(undefined)).toBe(MIRROR_DEFAULT_MAX_CLIENTS);
    expect(clampMirrorMaxClients(null)).toBe(MIRROR_DEFAULT_MAX_CLIENTS);
    expect(clampMirrorMaxClients("")).toBe(MIRROR_DEFAULT_MAX_CLIENTS);
    expect(clampMirrorMaxClients("nope")).toBe(MIRROR_DEFAULT_MAX_CLIENTS);
    expect(clampMirrorMaxClients(Number.NaN)).toBe(MIRROR_DEFAULT_MAX_CLIENTS);
  });

  it("clamps to 1–16", () => {
    expect(clampMirrorMaxClients(0)).toBe(MIRROR_MIN_CLIENTS);
    expect(clampMirrorMaxClients(-3)).toBe(MIRROR_MIN_CLIENTS);
    expect(clampMirrorMaxClients(1)).toBe(1);
    expect(clampMirrorMaxClients(4)).toBe(4);
    expect(clampMirrorMaxClients(16)).toBe(MIRROR_MAX_CLIENTS_CAP);
    expect(clampMirrorMaxClients(99)).toBe(MIRROR_MAX_CLIENTS_CAP);
    expect(clampMirrorMaxClients("8")).toBe(8);
    expect(clampMirrorMaxClients(3.6)).toBe(4);
  });
});

describe("resolveMirrorClientCapState", () => {
  it("ok when room and write off", () => {
    const s = resolveMirrorClientCapState({
      connected: 1,
      max: 4,
      writeEnabled: false,
    });
    expect(s.kind).toBe("ok");
    expect(s.connected).toBe(1);
    expect(s.max).toBe(4);
    expect(s.remaining).toBe(3);
    expect(s.atLimit).toBe(false);
    expect(s.nearFull).toBe(false);
    expect(s.showFullBanner).toBe(false);
    expect(s.showWriteOnWarn).toBe(false);
    expect(s.tone).toBe("ok");
    expect(s.fillPercent).toBe(25);
  });

  it("near_full when one slot left", () => {
    const s = resolveMirrorClientCapState({
      connected: 3,
      max: 4,
      writeEnabled: false,
    });
    expect(s.kind).toBe("near_full");
    expect(s.nearFull).toBe(true);
    expect(s.remaining).toBe(1);
    expect(s.showFullBanner).toBe(false);
    expect(s.tone).toBe("warn");
  });

  it("near_full at ≥75% fill for larger caps", () => {
    const s = resolveMirrorClientCapState({
      connected: 12,
      max: 16,
      writeEnabled: false,
    });
    expect(s.kind).toBe("near_full");
    expect(s.ratio).toBe(0.75);
    expect(s.remaining).toBe(4);
  });

  it("full when connected ≥ max (503 soft-fail honesty)", () => {
    const s = resolveMirrorClientCapState({
      connected: 4,
      max: 4,
      writeEnabled: false,
    });
    expect(s.kind).toBe("full");
    expect(s.atLimit).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.showFullBanner).toBe(true);
    expect(s.fillPercent).toBe(100);
    expect(s.tone).toBe("warn");
  });

  it("full when over-subscribed (host may report before drop)", () => {
    const s = resolveMirrorClientCapState({
      connected: 6,
      max: 4,
    });
    expect(s.kind).toBe("full");
    expect(s.connected).toBe(6);
    expect(s.remaining).toBe(0);
    expect(s.ratio).toBe(1);
    expect(s.fillPercent).toBe(100);
  });

  it("write_on_warn when write on and capacity ok", () => {
    const s = resolveMirrorClientCapState({
      connected: 0,
      max: 4,
      writeEnabled: true,
    });
    expect(s.kind).toBe("write_on_warn");
    expect(s.showWriteOnWarn).toBe(true);
    expect(s.showFullBanner).toBe(false);
    expect(s.tone).toBe("warn");
  });

  it("full wins over write_on_warn but keeps showWriteOnWarn", () => {
    const s = resolveMirrorClientCapState({
      connected: 4,
      max: 4,
      writeEnabled: true,
    });
    expect(s.kind).toBe("full");
    expect(s.showFullBanner).toBe(true);
    expect(s.showWriteOnWarn).toBe(true);
  });

  it("near_full wins over write_on_warn", () => {
    const s = resolveMirrorClientCapState({
      connected: 3,
      max: 4,
      writeEnabled: true,
    });
    expect(s.kind).toBe("near_full");
    expect(s.showWriteOnWarn).toBe(true);
  });

  it("clamps max and non-finite connected", () => {
    const s = resolveMirrorClientCapState({
      connected: -2,
      max: 100,
      writeEnabled: false,
    });
    expect(s.max).toBe(MIRROR_MAX_CLIENTS_CAP);
    expect(s.connected).toBe(0);
    expect(s.kind).toBe("ok");
    expect(s.tone).toBe("muted");
  });

  it("defaults max when omitted", () => {
    const s = resolveMirrorClientCapState({ connected: 0 });
    expect(s.max).toBe(MIRROR_DEFAULT_MAX_CLIENTS);
    expect(s.kind).toBe("ok");
  });

  it("max=1 full at first client; near_full never with 0 remaining", () => {
    expect(
      resolveMirrorClientCapState({ connected: 0, max: 1 }).kind,
    ).toBe("ok");
    const full = resolveMirrorClientCapState({ connected: 1, max: 1 });
    expect(full.kind).toBe("full");
    expect(full.nearFull).toBe(false);
  });
});

describe("formatMirrorClientCapLine", () => {
  it("formats n / max", () => {
    expect(
      formatMirrorClientCapLine({ connected: 2, max: 4, remaining: 2 }),
    ).toBe("2 / 4");
    expect(
      formatMirrorClientCapLine(
        { connected: 0, max: 8, remaining: 8 },
        "{n} of {max} ({remaining} free)",
      ),
    ).toBe("0 of 8 (8 free)");
  });
});

describe("resolveMirrorCapEmptyState", () => {
  it("host stopped never invents clients", () => {
    const e = resolveMirrorCapEmptyState({
      running: false,
      connected: 3,
    });
    expect(e).toEqual({
      kind: "host_stopped",
      titleKey: "mirror.cap.emptyStopped",
      hintKey: "mirror.cap.emptyStoppedHint",
    });
  });

  it("stopped when running omitted/false", () => {
    expect(resolveMirrorCapEmptyState({})?.kind).toBe("host_stopped");
    expect(resolveMirrorCapEmptyState({ running: null })?.kind).toBe(
      "host_stopped",
    );
  });

  it("zero clients honesty while host running", () => {
    const e = resolveMirrorCapEmptyState({ running: true, connected: 0 });
    expect(e).toEqual({
      kind: "zero_clients",
      titleKey: "mirror.cap.emptyZero",
      hintKey: "mirror.cap.emptyZeroHint",
    });
  });

  it("null when live clients present", () => {
    expect(
      resolveMirrorCapEmptyState({ running: true, connected: 1 }),
    ).toBeNull();
  });
});

describe("i18n / tone helpers", () => {
  it("maps kind → label/hint keys", () => {
    expect(mirrorClientCapKindLabelKey("full")).toBe("mirror.cap.full");
    expect(mirrorClientCapKindLabelKey("near_full")).toBe(
      "mirror.cap.nearFull",
    );
    expect(mirrorClientCapKindLabelKey("write_on_warn")).toBe(
      "mirror.cap.writeOnWarn",
    );
    expect(mirrorClientCapKindLabelKey("ok")).toBe("mirror.cap.ok");
    expect(mirrorClientCapKindHintKey("full")).toBe("mirror.cap.fullHint");
    expect(mirrorClientCapKindHintKey("near_full")).toBe(
      "mirror.cap.nearFullHint",
    );
  });

  it("tone CSS classes", () => {
    expect(mirrorClientCapToneClass("ok")).toContain("--ok");
    expect(mirrorClientCapToneClass("warn")).toContain("--warn");
    expect(mirrorClientCapToneClass("err")).toContain("--err");
    expect(mirrorClientCapToneClass("muted")).toContain("--muted");
  });
});
