import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_NOTE_MAX_LENGTH,
  SESSION_NOTE_NEAR_CAP_RATIO,
  SESSION_NOTES_CHANGE_EVENT,
  SESSION_NOTES_STORAGE_KEY,
  applyClearOneNote,
  clampNoteText,
  clampSessionNoteInput,
  clearAllNotes,
  clearNote,
  countSessionNotes,
  getNote,
  hasNote,
  isSessionNoteDirty,
  listSessionNoteEntries,
  load,
  loadSessionNotes,
  notePreview,
  parseSessionNotes,
  planClearAllNotes,
  planClearOneNote,
  resolveSessionNotesEmptyState,
  save,
  saveSessionNotes,
  searchSessionNotes,
  sessionNoteBudget,
  sessionNoteLogMeta,
  sessionNoteSaveOutcome,
  setNote,
  shouldConfirmSessionNoteClear,
  shouldConfirmSessionNoteDiscard,
  sanitizeSessionNote,
  validateSessionNote,
  type SessionNotesStorage,
} from "./sessionNotes";

function memoryStorage(
  initial: Record<string, string> = {},
): SessionNotesStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clampNoteText", () => {
  it("returns empty for non-strings and zero max", () => {
    // @ts-expect-error intentional
    expect(clampNoteText(null)).toBe("");
    expect(clampNoteText("hi", 0)).toBe("");
  });

  it("truncates to max length", () => {
    const long = "a".repeat(SESSION_NOTE_MAX_LENGTH + 50);
    const clamped = clampNoteText(long);
    expect(clamped.length).toBe(SESSION_NOTE_MAX_LENGTH);
    expect(clampNoteText("short")).toBe("short");
  });
});

describe("notePreview", () => {
  it("collapses whitespace and truncates with ellipsis", () => {
    expect(notePreview(null)).toBe("");
    expect(notePreview("  hello   world  ")).toBe("hello world");
    expect(notePreview("abcdefghij", 5)).toBe("abcd…");
    expect(notePreview("ab", 5)).toBe("ab");
  });
});

describe("parseSessionNotes", () => {
  it("returns empty object for empty / invalid input", () => {
    expect(parseSessionNotes(null)).toEqual({});
    expect(parseSessionNotes(undefined)).toEqual({});
    expect(parseSessionNotes("")).toEqual({});
    expect(parseSessionNotes("not-json")).toEqual({});
    expect(parseSessionNotes("[]")).toEqual({});
    expect(parseSessionNotes(42)).toEqual({});
  });

  it("parses map of non-empty string notes and clamps", () => {
    const long = "x".repeat(SESSION_NOTE_MAX_LENGTH + 10);
    const map = parseSessionNotes(
      JSON.stringify({
        a: "  keep  ",
        "  b  ": "trimmed-id",
        "": "skip-empty-id",
        c: "   ",
        d: 1,
        e: long,
      }),
    );
    expect(map.a).toBe("  keep  ");
    expect(map.b).toBe("trimmed-id");
    expect(map.c).toBeUndefined();
    expect(map.d).toBeUndefined();
    expect(map.e?.length).toBe(SESSION_NOTE_MAX_LENGTH);
    expect(Object.keys(map).sort()).toEqual(["a", "b", "e"]);
  });

  it("accepts already-parsed objects", () => {
    expect(parseSessionNotes({ s1: "note" })).toEqual({ s1: "note" });
  });
});

describe("load / save", () => {
  it("load returns empty map when missing", () => {
    const storage = memoryStorage();
    expect(loadSessionNotes(storage)).toEqual({});
    expect(load(storage)).toEqual({});
  });

  it("round-trips notes and drops blanks; sorts keys on write", () => {
    const storage = memoryStorage();
    saveSessionNotes(
      { z: "Z", a: "A", m: "  ", "  b  ": "B" },
      storage,
    );
    const raw = JSON.parse(storage.data[SESSION_NOTES_STORAGE_KEY]!);
    expect(Object.keys(raw)).toEqual(["a", "b", "z"]);
    expect(raw).toEqual({ a: "A", b: "B", z: "Z" });
    expect(loadSessionNotes(storage)).toEqual({ a: "A", b: "B", z: "Z" });
    save({ only: "one" }, storage);
    expect(load(storage)).toEqual({ only: "one" });
  });

  it("removes storage key when map becomes empty", () => {
    const storage = memoryStorage({
      [SESSION_NOTES_STORAGE_KEY]: JSON.stringify({ a: "x" }),
    });
    saveSessionNotes({}, storage);
    expect(storage.data[SESSION_NOTES_STORAGE_KEY]).toBeUndefined();
  });

  it("load survives corrupt JSON", () => {
    const storage = memoryStorage({
      [SESSION_NOTES_STORAGE_KEY]: "{broken",
    });
    expect(loadSessionNotes(storage)).toEqual({});
  });

  it("dispatches change event after save when window is available", () => {
    const storage = memoryStorage();
    const handler = vi.fn();
    const prevWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      value: {
        dispatchEvent: handler,
      },
      configurable: true,
      writable: true,
    });
    try {
      saveSessionNotes({ s1: "n" }, storage);
      expect(handler).toHaveBeenCalledTimes(1);
      const ev = handler.mock.calls[0]![0] as CustomEvent;
      expect(ev.type).toBe(SESSION_NOTES_CHANGE_EVENT);
      expect(ev.detail).toEqual(["s1"]);
    } finally {
      if (prevWindow === undefined) {
        // @ts-expect-error cleanup
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, "window", {
          value: prevWindow,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});

describe("getNote / hasNote / setNote / clearNote", () => {
  it("getNote and hasNote handle missing / blank ids", () => {
    const storage = memoryStorage();
    expect(getNote(null, storage)).toBe("");
    expect(getNote("  ", storage)).toBe("");
    expect(hasNote("missing", storage)).toBe(false);
  });

  it("setNote writes, clamps, and clearNote removes", () => {
    const storage = memoryStorage();
    const long = "y".repeat(SESSION_NOTE_MAX_LENGTH + 20);
    expect(setNote("sess-1", "  hello  ", storage)).toBe("  hello  ");
    expect(getNote("sess-1", storage)).toBe("  hello  ");
    expect(hasNote("sess-1", storage)).toBe(true);
    expect(setNote("sess-1", long, storage).length).toBe(SESSION_NOTE_MAX_LENGTH);
    expect(setNote("sess-1", "   ", storage)).toBe("");
    expect(hasNote("sess-1", storage)).toBe(false);
    setNote("sess-2", "keep", storage);
    clearNote("sess-2", storage);
    expect(getNote("sess-2", storage)).toBe("");
  });

  it("setNote ignores blank session ids", () => {
    const storage = memoryStorage();
    expect(setNote("", "x", storage)).toBe("");
    expect(setNote("   ", "x", storage)).toBe("");
    expect(loadSessionNotes(storage)).toEqual({});
  });

  it("trims session ids on get", () => {
    const storage = memoryStorage();
    setNote("sess-x", "note", storage);
    expect(getNote("  sess-x  ", storage)).toBe("note");
    expect(hasNote("  sess-x  ", storage)).toBe(true);
  });
});

describe("sessionNoteBudget / validateSessionNote", () => {
  it("marks empty drafts", () => {
    const v = validateSessionNote({
      draft: "   ",
      baseline: "",
    });
    expect(v.budget.empty).toBe(true);
    expect(v.status).toBe("empty");
    expect(v.sanitized.trim()).toBe("");
    expect(v.statusKey).toBe("session.noteStatus.empty");
    expect(v.severity).toBe("info");
  });

  it("marks will_clear when stored value is emptied", () => {
    const v = validateSessionNote({
      draft: "",
      baseline: "remember the deploy key",
      hadStored: true,
    });
    expect(v.status).toBe("will_clear");
    expect(v.dirty).toBe(true);
    expect(v.statusKey).toBe("session.noteStatus.willClear");
  });

  it("warns near and at cap", () => {
    const max = 100;
    const near = "x".repeat(Math.floor(max * SESSION_NOTE_NEAR_CAP_RATIO));
    const vNear = validateSessionNote({
      draft: near,
      maxLen: max,
    });
    expect(vNear.budget.nearCap).toBe(true);
    expect(vNear.status).toBe("near_cap");
    expect(vNear.severity).toBe("warn");
    expect(vNear.statusKey).toBe("session.noteStatus.nearCap");

    const at = "y".repeat(max);
    const vAt = validateSessionNote({
      draft: at,
      maxLen: max,
    });
    expect(vAt.budget.atCap).toBe(true);
    expect(vAt.status).toBe("at_cap");
    expect(vAt.statusKey).toBe("session.noteStatus.atCap");
  });

  it("flags NUL strip as warn", () => {
    const v = validateSessionNote({
      draft: "be\0nice",
      maxLen: 64,
    });
    expect(v.budget.nulStripped).toBe(true);
    expect(v.sanitized).toBe("benice");
    expect(v.status).toBe("nul_stripped");
    expect(v.statusKey).toBe("session.noteStatus.nulStripped");
  });

  it("detects dirty vs baseline", () => {
    const clean = validateSessionNote({
      draft: "same",
      baseline: "same",
    });
    expect(clean.dirty).toBe(false);
    expect(shouldConfirmSessionNoteDiscard(clean)).toBe(false);

    const dirty = validateSessionNote({
      draft: "changed",
      baseline: "same",
    });
    expect(dirty.dirty).toBe(true);
    expect(shouldConfirmSessionNoteDiscard(dirty)).toBe(true);
  });

  it("budget remaining never goes negative", () => {
    const b = sessionNoteBudget("x".repeat(50), 10);
    expect(b.remaining).toBe(0);
    expect(b.rawLen).toBe(50);
    expect(b.clamped).toBe(true);
  });

  it("isSessionNoteDirty treats null baseline as empty", () => {
    expect(isSessionNoteDirty("", null)).toBe(false);
    expect(isSessionNoteDirty("a", null)).toBe(true);
    expect(isSessionNoteDirty(null, "a")).toBe(true);
  });
});

describe("clampSessionNoteInput / sanitizeSessionNote", () => {
  it("strips NULs without clamping short text", () => {
    const r = clampSessionNoteInput("a\0b\0c", 100);
    expect(r).toEqual({ value: "abc", clamped: false, nulStripped: true });
  });

  it("clamps to max and reports flags", () => {
    const r = clampSessionNoteInput("hello world", 5);
    expect(r.value).toBe("hello");
    expect(r.clamped).toBe(true);
    expect(r.nulStripped).toBe(false);
  });

  it("preserves interior spaces (no trim on keystroke)", () => {
    expect(clampSessionNoteInput("  hi  ", 100).value).toBe("  hi  ");
    expect(sanitizeSessionNote("  hi  ")).toBe("  hi  ");
  });
});

describe("shouldConfirmSessionNoteClear", () => {
  it("confirms when stored or draft is non-empty", () => {
    expect(shouldConfirmSessionNoteClear({ hadStored: true })).toBe(true);
    expect(shouldConfirmSessionNoteClear({ draft: "  x  " })).toBe(true);
    expect(shouldConfirmSessionNoteClear({ draft: "   ", hadStored: false })).toBe(
      false,
    );
    expect(shouldConfirmSessionNoteClear({})).toBe(false);
  });
});

describe("sessionNoteSaveOutcome / logMeta", () => {
  it("returns cleared vs saved toast keys without body", () => {
    expect(sessionNoteSaveOutcome("s1", null)).toEqual({
      kind: "cleared",
      logMeta: null,
      toastKey: "session.noteCleared",
    });
    const saved = sessionNoteSaveOutcome("s1", "  ship friday  ");
    expect(saved.kind).toBe("saved");
    expect(saved.toastKey).toBe("session.noteSaved");
    // Sanitize preserves interior spaces; length is raw sanitized (not trim).
    expect(saved.logMeta).toEqual({ sessionId: "s1", chars: 15 });
    expect(JSON.stringify(saved)).not.toContain("ship friday");
  });

  it("sessionNoteLogMeta never includes body", () => {
    const meta = sessionNoteLogMeta("sess-1", "sk-secret-note-body");
    expect(meta).toEqual({ sessionId: "sess-1", chars: 19 });
    expect(JSON.stringify(meta)).not.toContain("sk-");
    expect(sessionNoteLogMeta("sess-1", "  ")).toBe(null);
    expect(sessionNoteLogMeta("", "x")).toBe(null);
  });
});

describe("list / search / empty states", () => {
  const map = {
    a: "deploy notes for prod",
    b: "local only scratch",
    c: "   ",
  };
  const titles = {
    a: "Prod rollout",
    b: "Scratch pad",
  };

  it("lists non-empty notes with previews and optional titles", () => {
    const entries = listSessionNoteEntries(map, titles);
    expect(entries.map((e) => e.sessionId)).toEqual(["a", "b"]);
    expect(entries[0]!.title).toBe("Prod rollout");
    expect(entries[0]!.preview).toContain("deploy");
    expect(entries[0]!.chars).toBe(map.a.length);
    expect(countSessionNotes(map)).toBe(2);
    expect(countSessionNotes({})).toBe(0);
    expect(countSessionNotes(null)).toBe(0);
  });

  it("searches by content, title, and session id", () => {
    expect(searchSessionNotes(map, "deploy", titles).map((e) => e.sessionId)).toEqual(
      ["a"],
    );
    expect(searchSessionNotes(map, "scratch", titles).map((e) => e.sessionId)).toEqual(
      ["b"],
    );
    expect(searchSessionNotes(map, "  ", titles)).toHaveLength(2);
    expect(searchSessionNotes(map, "nope", titles)).toHaveLength(0);
    expect(searchSessionNotes(map, "a", titles).some((e) => e.sessionId === "a")).toBe(
      true,
    );
  });

  it("resolves honest empty states", () => {
    expect(resolveSessionNotesEmptyState({ noSession: true })?.kind).toBe(
      "no_session",
    );
    expect(resolveSessionNotesEmptyState({ map: {} })?.kind).toBe("no_notes");
    expect(
      resolveSessionNotesEmptyState({ map: {}, emptyDraft: true })?.messageKey,
    ).toBe("session.noteStatus.empty");
    expect(
      resolveSessionNotesEmptyState({ map, query: "zzzz" })?.kind,
    ).toBe("no_matches");
    expect(resolveSessionNotesEmptyState({ map, query: "deploy" })).toBe(null);
    expect(resolveSessionNotesEmptyState({ map })).toBe(null);
  });
});

describe("planClearOneNote / planClearAllNotes", () => {
  it("plans clear-one without mutating input and omits body from logMeta", () => {
    const map = { s1: "secret body", s2: "keep me" };
    const plan = planClearOneNote(map, "s1");
    expect(plan.ok).toBe(true);
    expect(plan.hadNote).toBe(true);
    expect(plan.nextMap).toEqual({ s2: "keep me" });
    expect(map).toEqual({ s1: "secret body", s2: "keep me" });
    expect(plan.logMeta).toEqual({ sessionId: "s1", cleared: true });
    expect(JSON.stringify(plan)).not.toContain("secret body");

    const missing = planClearOneNote(map, "missing");
    expect(missing.ok).toBe(true);
    expect(missing.hadNote).toBe(false);
    expect(missing.logMeta).toBe(null);

    const bad = planClearOneNote(map, "  ");
    expect(bad.ok).toBe(false);
    expect(bad.sessionId).toBe(null);
  });

  it("plans clear-all with count and ids only", () => {
    const map = { z: "Z", a: "A" };
    const plan = planClearAllNotes(map);
    expect(plan.ok).toBe(true);
    expect(plan.count).toBe(2);
    expect(plan.sessionIds).toEqual(["a", "z"]);
    expect(plan.nextMap).toEqual({});
    expect(plan.logMeta).toEqual({ clearedCount: 2 });
    expect(JSON.stringify(plan)).not.toContain('"A"');

    const empty = planClearAllNotes({});
    expect(empty.count).toBe(0);
    expect(empty.logMeta).toBe(null);
  });

  it("applyClearOneNote and clearAllNotes update storage", () => {
    const storage = memoryStorage();
    setNote("s1", "one", storage);
    setNote("s2", "two", storage);
    expect(applyClearOneNote("s1", storage)).toBe(true);
    expect(hasNote("s1", storage)).toBe(false);
    expect(hasNote("s2", storage)).toBe(true);
    expect(applyClearOneNote("s1", storage)).toBe(false);

    expect(clearAllNotes(storage)).toBe(1);
    expect(loadSessionNotes(storage)).toEqual({});
    expect(clearAllNotes(storage)).toBe(0);
  });
});
