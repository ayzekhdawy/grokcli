import { describe, expect, it } from "vitest";
import {
  buildConfigEditPatch,
  hasConfigEditChanges,
  normalizePermissionMode,
  valuesFromSnapshot,
  type ConfigEditValues,
} from "./configTomlEdit";

const base: ConfigEditValues = {
  permissionMode: "default",
  yolo: false,
  subagentsEnabled: true,
  memoryEnabled: false,
  workflowsEnabled: true,
  autoWakeEnabled: true,
  twoPassCompactionEnabled: false,
  lspToolsEnabled: false,
  codebaseIndexing: true,
  remoteFetch: true,
};

describe("normalizePermissionMode", () => {
  it("maps aliases", () => {
    expect(normalizePermissionMode("default")).toBe("default");
    expect(normalizePermissionMode("accept_edits")).toBe("acceptEdits");
    expect(normalizePermissionMode("dontAsk")).toBe("dontAsk");
    expect(normalizePermissionMode("always-approve")).toBe("always-approve");
    expect(normalizePermissionMode("yolo")).toBe("always-approve");
    expect(normalizePermissionMode("nope")).toBeNull();
    expect(normalizePermissionMode("")).toBeNull();
  });
});

describe("buildConfigEditPatch", () => {
  it("emits only changed fields", () => {
    const draft: ConfigEditValues = {
      ...base,
      yolo: true,
      memoryEnabled: true,
      workflowsEnabled: false,
      twoPassCompactionEnabled: true,
    };
    const patch = buildConfigEditPatch(draft, base);
    expect(patch).toEqual({
      yolo: true,
      memoryEnabled: true,
      workflowsEnabled: false,
      twoPassCompactionEnabled: true,
    });
    expect(hasConfigEditChanges(patch)).toBe(true);
    expect(hasConfigEditChanges(buildConfigEditPatch(base, base))).toBe(false);
  });

  it("includes permission mode when set", () => {
    const draft: ConfigEditValues = {
      ...base,
      permissionMode: "dontAsk",
    };
    expect(buildConfigEditPatch(draft, base).permissionMode).toBe("dontAsk");
  });

  it("tracks feature toggles", () => {
    const draft: ConfigEditValues = {
      ...base,
      autoWakeEnabled: false,
      lspToolsEnabled: true,
      codebaseIndexing: false,
      remoteFetch: false,
    };
    expect(buildConfigEditPatch(draft, base)).toEqual({
      autoWakeEnabled: false,
      lspToolsEnabled: true,
      codebaseIndexing: false,
      remoteFetch: false,
    });
  });
});

describe("valuesFromSnapshot", () => {
  it("applies defaults for missing keys", () => {
    expect(valuesFromSnapshot({})).toEqual({
      permissionMode: "",
      yolo: false,
      subagentsEnabled: true,
      memoryEnabled: false,
      workflowsEnabled: true,
      autoWakeEnabled: true,
      twoPassCompactionEnabled: false,
      lspToolsEnabled: false,
      codebaseIndexing: true,
      remoteFetch: true,
    });
    expect(
      valuesFromSnapshot({
        permissionMode: "acceptEdits",
        yolo: true,
        subagentsEnabled: false,
        memoryEnabled: true,
        workflowsEnabled: false,
        autoWakeEnabled: false,
        twoPassCompactionEnabled: true,
        lspToolsEnabled: true,
        codebaseIndexing: false,
        remoteFetch: false,
      }),
    ).toEqual({
      permissionMode: "acceptEdits",
      yolo: true,
      subagentsEnabled: false,
      memoryEnabled: true,
      workflowsEnabled: false,
      autoWakeEnabled: false,
      twoPassCompactionEnabled: true,
      lspToolsEnabled: true,
      codebaseIndexing: false,
      remoteFetch: false,
    });
  });
});
