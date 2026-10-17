import { describe, expect, it } from "vitest";
import {
  MIRROR_WRITE_AUDIT_MAX,
  MIRROR_WRITE_AUDIT_NOTE_MAX,
  MIRROR_WRITE_AUDIT_STORAGE_KEY,
  clearMirrorWriteAudit,
  loadMirrorWriteAudit,
  mirrorWriteAuditTypeKey,
  parseMirrorWriteAudit,
  parseMirrorWriteAuditEvent,
  pushMirrorWriteAudit,
  recordMirrorWriteAudit,
  sanitizeMirrorWriteAuditNote,
  saveMirrorWriteAudit,
  type MirrorWriteAuditEvent,
  type MirrorWriteAuditStorage,
} from "./mirrorWriteAudit";

function memStorage(seed?: Record<string, string>): MirrorWriteAuditStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const sample = (
  n: number,
  overrides?: Partial<MirrorWriteAuditEvent>,
): MirrorWriteAuditEvent => ({
  id: `evt-${n}`,
  type: "write_enabled",
  at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  ...overrides,
});

describe("sanitizeMirrorWriteAuditNote", () => {
  it("trims and caps length", () => {
    expect(sanitizeMirrorWriteAuditNote("  hello  ")).toBe("hello");
    const long = "x".repeat(MIRROR_WRITE_AUDIT_NOTE_MAX + 50);
    expect(sanitizeMirrorWriteAuditNote(long)?.length).toBe(
      MIRROR_WRITE_AUDIT_NOTE_MAX,
    );
  });

  it("drops empty / non-string / control-only", () => {
    expect(sanitizeMirrorWriteAuditNote("")).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote("   ")).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote(null)).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote(42)).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote("\u0000\u0001")).toBeUndefined();
  });

  it("never keeps URLs or token-looking notes", () => {
    expect(
      sanitizeMirrorWriteAuditNote("https://example.trycloudflare.com/?token=abc"),
    ).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote("open http://localhost:9/?t=1")).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote("token=sekritvalue")).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote("token: sekrit")).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote("Bearer abc.def.ghi")).toBeUndefined();
    expect(sanitizeMirrorWriteAuditNote("?token=xyz")).toBeUndefined();
  });

  it("allows safe short notes", () => {
    expect(sanitizeMirrorWriteAuditNote("user confirmed")).toBe("user confirmed");
  });
});

describe("parseMirrorWriteAuditEvent", () => {
  it("accepts valid events and drops unknown fields", () => {
    expect(
      parseMirrorWriteAuditEvent({
        id: "  a1  ",
        type: "token_rotated",
        at: "2026-01-01T00:00:00.000Z",
        note: "ok",
        token: "MUST_NOT_STORE",
        publicUrl: "https://evil/?token=x",
      }),
    ).toEqual({
      id: "a1",
      type: "token_rotated",
      at: "2026-01-01T00:00:00.000Z",
      note: "ok",
    });
  });

  it("rejects invalid type / missing id", () => {
    expect(parseMirrorWriteAuditEvent({ id: "a", type: "nope" })).toBeNull();
    expect(parseMirrorWriteAuditEvent({ type: "write_enabled" })).toBeNull();
    expect(parseMirrorWriteAuditEvent({ id: "  ", type: "write_enabled" })).toBeNull();
    expect(parseMirrorWriteAuditEvent(null)).toBeNull();
    expect(parseMirrorWriteAuditEvent("nope")).toBeNull();
  });

  it("defaults missing at; strips unsafe note", () => {
    const e = parseMirrorWriteAuditEvent({
      id: "x",
      type: "host_started",
      note: "https://leak/?token=1",
    });
    expect(e?.type).toBe("host_started");
    expect(e?.at).toBeTruthy();
    expect(e?.note).toBeUndefined();
  });

  it("accepts all known types", () => {
    for (const type of [
      "write_enabled",
      "write_disabled",
      "token_rotated",
      "host_started",
      "host_stopped",
    ] as const) {
      expect(parseMirrorWriteAuditEvent({ id: type, type })?.type).toBe(type);
    }
  });
});

describe("parseMirrorWriteAudit", () => {
  it("parses JSON string and array, newest-first order preserved", () => {
    const a = sample(1);
    const b = sample(2, { type: "write_disabled" });
    expect(parseMirrorWriteAudit(JSON.stringify([a, b]))).toEqual([a, b]);
    expect(parseMirrorWriteAudit([a, b])).toEqual([a, b]);
  });

  it("returns empty on corrupt input", () => {
    expect(parseMirrorWriteAudit("{not json")).toEqual([]);
    expect(parseMirrorWriteAudit(42)).toEqual([]);
    expect(parseMirrorWriteAudit(undefined)).toEqual([]);
  });

  it("caps at max and dedupes by id", () => {
    const many = Array.from({ length: 60 }, (_, i) => sample(i));
    expect(parseMirrorWriteAudit(many, 5)).toHaveLength(5);
    expect(parseMirrorWriteAudit(many).length).toBeLessThanOrEqual(
      MIRROR_WRITE_AUDIT_MAX,
    );

    const dup = [sample(1), sample(1, { type: "write_disabled" }), sample(2)];
    const parsed = parseMirrorWriteAudit(dup);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("evt-1");
    expect(parsed[0].type).toBe("write_enabled"); // first wins
  });
});

describe("pushMirrorWriteAudit (ring)", () => {
  it("prepends newest and enforces max", () => {
    const existing = [sample(1), sample(2)];
    const next = pushMirrorWriteAudit(existing, sample(3, { type: "token_rotated" }), 2);
    expect(next).toHaveLength(2);
    expect(next[0].id).toBe("evt-3");
    expect(next[0].type).toBe("token_rotated");
    expect(next[1].id).toBe("evt-1");
  });

  it("replaces same id and moves to front", () => {
    const existing = [sample(1), sample(2)];
    const next = pushMirrorWriteAudit(
      existing,
      sample(2, { type: "host_stopped", at: "2026-06-01T00:00:00.000Z" }),
    );
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({
      id: "evt-2",
      type: "host_stopped",
      at: "2026-06-01T00:00:00.000Z",
    });
    expect(next[1].id).toBe("evt-1");
  });

  it("ignores invalid entry", () => {
    const existing = [sample(1)];
    const next = pushMirrorWriteAudit(existing, {
      id: "",
      type: "write_enabled",
      at: "x",
    });
    expect(next).toEqual(existing);
  });
});

describe("load / save / record / clear", () => {
  it("round-trips via storage", () => {
    const storage = memStorage();
    const list = [sample(1, { type: "token_rotated" }), sample(2)];
    saveMirrorWriteAudit(list, storage);
    expect(loadMirrorWriteAudit(storage)).toEqual(list);
    const raw = storage.getItem(MIRROR_WRITE_AUDIT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    // Must never embed token-like secrets from dropped fields
    expect(raw).not.toMatch(/MUST_NOT/);
  });

  it("recordMirrorWriteAudit appends sanitized events", () => {
    const storage = memStorage();
    const a = recordMirrorWriteAudit(
      { type: "write_enabled", id: "r1", at: "2026-01-01T00:00:00.000Z" },
      storage,
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toEqual({
      id: "r1",
      type: "write_enabled",
      at: "2026-01-01T00:00:00.000Z",
    });

    const b = recordMirrorWriteAudit(
      {
        type: "token_rotated",
        id: "r2",
        note: "https://example.com/?token=abc",
        at: "2026-01-02T00:00:00.000Z",
      },
      storage,
    );
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({
      id: "r2",
      type: "token_rotated",
      at: "2026-01-02T00:00:00.000Z",
    });
    expect(b[0].note).toBeUndefined();
    expect(JSON.stringify(b)).not.toMatch(/token=abc/);
  });

  it("record generates id when omitted", () => {
    const storage = memStorage();
    const list = recordMirrorWriteAudit({ type: "host_started" }, storage);
    expect(list).toHaveLength(1);
    expect(list[0].id.length).toBeGreaterThan(4);
    expect(list[0].type).toBe("host_started");
  });

  it("clearMirrorWriteAudit empties storage", () => {
    const storage = memStorage();
    recordMirrorWriteAudit({ type: "write_disabled", id: "c1" }, storage);
    expect(loadMirrorWriteAudit(storage)).toHaveLength(1);
    const cleared = clearMirrorWriteAudit(storage);
    expect(cleared).toEqual([]);
    expect(loadMirrorWriteAudit(storage)).toEqual([]);
  });

  it("rejects unknown type on record", () => {
    const storage = memStorage();
    // @ts-expect-error intentional invalid type
    const list = recordMirrorWriteAudit({ type: "evil", id: "x" }, storage);
    expect(list).toEqual([]);
  });
});

describe("mirrorWriteAuditTypeKey", () => {
  it("returns stable i18n key path", () => {
    expect(mirrorWriteAuditTypeKey("write_enabled")).toBe(
      "mirror.audit.type.write_enabled",
    );
    expect(mirrorWriteAuditTypeKey("token_rotated")).toBe(
      "mirror.audit.type.token_rotated",
    );
  });
});
