import { describe, expect, it } from "vitest";
import {
  CODEBASE_INDEXING_CLI_DEFAULT,
  CODEBASE_INDEXING_CONFIG_KEY,
  CODEBASE_INDEXING_CONFIG_PATH,
  CODEBASE_INDEXING_CONFIG_TABLE,
  CODEBASE_INDEXING_MIN_CLI,
  buildCodebaseIndexingPatch,
  cliSupportsCodebaseIndexing,
  codebaseIndexingConfigAssignment,
  codebaseIndexingEqual,
  codebaseIndexingKind,
  codebaseIndexingPresence,
  codebaseIndexingToggleChecked,
  describeCodebaseIndexingStatus,
  effectiveCodebaseIndexingEnabled,
  hasCodebaseIndexingChanges,
  isCodebaseIndexingToggleable,
  isCodebaseIndexingWritable,
  toggleCodebaseIndexingTri,
  valuesFromCodebaseIndexingSnapshot,
} from "./codebaseIndexing";

describe("valuesFromCodebaseIndexingSnapshot", () => {
  it("maps missing keys to null (soft-fail, never invents defaults)", () => {
    const v = valuesFromCodebaseIndexingSnapshot({});
    expect(v).toEqual({ enabled: null, customRaw: null });
    expect(codebaseIndexingPresence(v)).toBe("unset");
    // Effective follows CLI default, but presence stays unset.
    expect(effectiveCodebaseIndexingEnabled(v)).toBe(
      CODEBASE_INDEXING_CLI_DEFAULT,
    );
    expect(codebaseIndexingToggleChecked(v)).toBe(false);
  });

  it("maps bool true/false honestly", () => {
    expect(
      valuesFromCodebaseIndexingSnapshot({ enabled: true, kind: "bool" }),
    ).toEqual({ enabled: true, customRaw: null });
    expect(
      valuesFromCodebaseIndexingSnapshot({ enabled: false }),
    ).toEqual({ enabled: false, customRaw: null });
  });

  it("maps custom (non-bool) without inventing a bool", () => {
    const v = valuesFromCodebaseIndexingSnapshot({
      kind: "custom",
      customRaw: '["src/**", "lib/**"]',
    });
    expect(v.enabled).toBe(null);
    expect(v.customRaw).toBe('["src/**", "lib/**"]');
    expect(codebaseIndexingPresence(v)).toBe("custom");
    expect(isCodebaseIndexingToggleable(v)).toBe(false);
    expect(effectiveCodebaseIndexingEnabled(v)).toBe(true);
  });
});

describe("buildCodebaseIndexingPatch", () => {
  it("only patches concrete bool flips", () => {
    const base = valuesFromCodebaseIndexingSnapshot({});
    const draft = { ...base, enabled: true as const };
    expect(buildCodebaseIndexingPatch(draft, base)).toEqual({ enabled: true });
    expect(
      hasCodebaseIndexingChanges(buildCodebaseIndexingPatch(draft, base)),
    ).toBe(true);
    expect(buildCodebaseIndexingPatch(base, base)).toEqual({});
    expect(hasCodebaseIndexingChanges({})).toBe(false);
  });

  it("does not patch null draft (unset stays unset)", () => {
    const base = valuesFromCodebaseIndexingSnapshot({ enabled: true });
    const draft = { enabled: null, customRaw: null };
    expect(buildCodebaseIndexingPatch(draft, base)).toEqual({});
  });
});

describe("toggleCodebaseIndexingTri", () => {
  it("unset → true, then flips", () => {
    expect(toggleCodebaseIndexingTri(null)).toBe(true);
    expect(toggleCodebaseIndexingTri(true)).toBe(false);
    expect(toggleCodebaseIndexingTri(false)).toBe(true);
  });
});

describe("codebaseIndexingKind", () => {
  it("classifies unset / bool / custom", () => {
    expect(codebaseIndexingKind({})).toBe("unset");
    expect(codebaseIndexingKind({ enabled: true })).toBe("bool");
    expect(codebaseIndexingKind({ enabled: false })).toBe("bool");
    expect(
      codebaseIndexingKind({ kind: "custom", customRaw: '"src/**"' }),
    ).toBe("custom");
  });
});

describe("cliSupportsCodebaseIndexing", () => {
  it("parses version tokens (≥ 0.2.117)", () => {
    expect(cliSupportsCodebaseIndexing("0.2.117")).toBe(true);
    expect(cliSupportsCodebaseIndexing("grok 0.2.117 (abc)")).toBe(true);
    expect(cliSupportsCodebaseIndexing("0.2.118")).toBe(true);
    expect(cliSupportsCodebaseIndexing("0.3.0")).toBe(true);
    expect(cliSupportsCodebaseIndexing("0.2.116")).toBe(false);
    expect(cliSupportsCodebaseIndexing("0.1.99")).toBe(false);
  });

  it("returns null for unknown (soft-fail)", () => {
    expect(cliSupportsCodebaseIndexing(null)).toBe(null);
    expect(cliSupportsCodebaseIndexing(undefined)).toBe(null);
    expect(cliSupportsCodebaseIndexing("")).toBe(null);
    expect(cliSupportsCodebaseIndexing("nope")).toBe(null);
  });
});

describe("describeCodebaseIndexingStatus", () => {
  it("never invents embeddings; code-graph only", () => {
    const s = describeCodebaseIndexingStatus(
      valuesFromCodebaseIndexingSnapshot({ enabled: true }),
      { cliVersion: "0.2.117" },
    );
    expect(s.isCodeGraphOnly).toBe(true);
    expect(s.inventsEmbeddings).toBe(false);
    expect(s.presence).toBe("set_on");
    expect(s.effective).toBe(true);
    expect(s.cliSupport).toBe(true);
  });

  it("unset shows effective default without claiming set_on", () => {
    const s = describeCodebaseIndexingStatus(
      valuesFromCodebaseIndexingSnapshot({}),
    );
    expect(s.presence).toBe("unset");
    expect(s.effective).toBe(true);
    expect(s.cliSupport).toBe(null);
  });

  it("known-old CLI soft-fails capability", () => {
    const s = describeCodebaseIndexingStatus(
      valuesFromCodebaseIndexingSnapshot({ enabled: true }),
      { cliVersion: "0.2.100" },
    );
    expect(s.cliSupport).toBe(false);
  });
});

describe("isCodebaseIndexingWritable", () => {
  it("requires writable flag", () => {
    expect(isCodebaseIndexingWritable({ writable: true })).toBe(true);
    expect(isCodebaseIndexingWritable({ writable: false })).toBe(false);
    expect(isCodebaseIndexingWritable(null)).toBe(false);
  });
});

describe("codebaseIndexingConfigAssignment", () => {
  it("emits bool assignment", () => {
    expect(codebaseIndexingConfigAssignment(true)).toBe(
      "codebase_indexing = true",
    );
    expect(codebaseIndexingConfigAssignment(false)).toBe(
      "codebase_indexing = false",
    );
    expect(codebaseIndexingConfigAssignment(null)).toBe(
      "codebase_indexing = false",
    );
  });
});

describe("codebaseIndexingEqual", () => {
  it("compares enabled + customRaw", () => {
    expect(
      codebaseIndexingEqual(
        { enabled: null, customRaw: null },
        { enabled: null, customRaw: null },
      ),
    ).toBe(true);
    expect(
      codebaseIndexingEqual(
        { enabled: true, customRaw: null },
        { enabled: false, customRaw: null },
      ),
    ).toBe(false);
  });
});

describe("config surface constants", () => {
  it("matches CLI user-guide surface", () => {
    expect(CODEBASE_INDEXING_CONFIG_TABLE).toBe("features");
    expect(CODEBASE_INDEXING_CONFIG_KEY).toBe("codebase_indexing");
    expect(CODEBASE_INDEXING_CONFIG_PATH).toBe(
      "[features] codebase_indexing",
    );
    expect(CODEBASE_INDEXING_MIN_CLI).toBe("0.2.117");
    expect(CODEBASE_INDEXING_CLI_DEFAULT).toBe(true);
  });
});
