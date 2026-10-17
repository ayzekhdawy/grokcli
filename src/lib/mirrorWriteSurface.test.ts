import { describe, expect, it } from "vitest";
import {
  MIRROR_DEFAULT_MAX_CLIENTS,
  MIRROR_MAX_CLIENTS_CAP,
  MIRROR_MIN_CLIENTS,
  MIRROR_WRITE_CATEGORIES,
  MIRROR_WRITE_METHODS,
  isBroadMirrorWriteSurface,
  mirrorWriteCategoryKey,
  normalizeMirrorMaxClients,
} from "./mirrorWriteSurface";

describe("mirrorWriteSurface", () => {
  it("lists categories with unique methods covering the allowlist", () => {
    expect(MIRROR_WRITE_CATEGORIES.length).toBeGreaterThanOrEqual(6);
    const methods = MIRROR_WRITE_METHODS;
    expect(methods).toContain("session.send");
    expect(methods).toContain("session.resolvePermission");
    expect(methods).toContain("session.create");
    expect(new Set(methods).size).toBe(methods.length);
  });

  it("treats the full allowlist as broad", () => {
    expect(isBroadMirrorWriteSurface()).toBe(true);
    expect(isBroadMirrorWriteSurface([...MIRROR_WRITE_METHODS])).toBe(true);
  });

  it("is not broad when empty or partial", () => {
    expect(isBroadMirrorWriteSurface([])).toBe(false);
    expect(isBroadMirrorWriteSurface(["session.send"])).toBe(false);
    expect(
      isBroadMirrorWriteSurface(["session.send", "session.stop"]),
    ).toBe(false);
  });

  it("ignores unknown methods when deciding broadness", () => {
    expect(
      isBroadMirrorWriteSurface([
        ...MIRROR_WRITE_METHODS,
        "desktop.only.method",
      ]),
    ).toBe(true);
  });

  it("builds stable i18n keys", () => {
    expect(mirrorWriteCategoryKey("send")).toBe("mirror.write.category.send");
    expect(mirrorWriteCategoryKey("permissions")).toBe(
      "mirror.write.category.permissions",
    );
  });

  it("normalizes max clients", () => {
    expect(normalizeMirrorMaxClients(undefined)).toBe(
      MIRROR_DEFAULT_MAX_CLIENTS,
    );
    expect(normalizeMirrorMaxClients(0)).toBe(MIRROR_MIN_CLIENTS);
    expect(normalizeMirrorMaxClients(4)).toBe(4);
    expect(normalizeMirrorMaxClients(99)).toBe(MIRROR_MAX_CLIENTS_CAP);
    expect(normalizeMirrorMaxClients("8")).toBe(8);
    expect(normalizeMirrorMaxClients("nope")).toBe(MIRROR_DEFAULT_MAX_CLIENTS);
  });
});
