/**
 * Pure helpers for allowlisted agent-home config.toml section edit.
 * Host enforces path-scope + write gate; this validates UI input + patches.
 */

/** Allowed `[ui].permission_mode` values (Grok Build config.toml). */
export const UI_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "always-approve",
] as const;

export type UiPermissionMode = (typeof UI_PERMISSION_MODES)[number];

export type ConfigEditValues = {
  permissionMode: UiPermissionMode | "";
  yolo: boolean;
  subagentsEnabled: boolean;
  memoryEnabled: boolean;
  workflowsEnabled: boolean;
  autoWakeEnabled: boolean;
  twoPassCompactionEnabled: boolean;
  lspToolsEnabled: boolean;
  codebaseIndexing: boolean;
  remoteFetch: boolean;
};

export type ConfigEditPatch = {
  permissionMode?: string | null;
  yolo?: boolean | null;
  subagentsEnabled?: boolean | null;
  memoryEnabled?: boolean | null;
  workflowsEnabled?: boolean | null;
  autoWakeEnabled?: boolean | null;
  twoPassCompactionEnabled?: boolean | null;
  lspToolsEnabled?: boolean | null;
  codebaseIndexing?: boolean | null;
  remoteFetch?: boolean | null;
};

/** Normalize a permission_mode string; returns null when unsupported. */
export function normalizePermissionMode(
  raw: string | null | undefined,
): UiPermissionMode | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const compact = t.toLowerCase().replace(/[_\s]/g, "-");
  switch (compact) {
    case "default":
    case "ask":
      return "default";
    case "acceptedits":
    case "accept-edits":
      return "acceptEdits";
    case "auto":
      return "auto";
    case "dontask":
    case "dont-ask":
      return "dontAsk";
    case "always-approve":
    case "alwaysapprove":
    case "bypasspermissions":
    case "yolo":
      return "always-approve";
    default:
      return null;
  }
}

export function isUiPermissionMode(v: string): v is UiPermissionMode {
  return (UI_PERMISSION_MODES as readonly string[]).includes(v);
}

/** Build a host patch from draft vs baseline (only changed fields). */
export function buildConfigEditPatch(
  draft: ConfigEditValues,
  baseline: ConfigEditValues,
): ConfigEditPatch {
  const patch: ConfigEditPatch = {};
  const draftMode = draft.permissionMode || null;
  const baseMode = baseline.permissionMode || null;
  if (draftMode !== baseMode && draftMode) {
    patch.permissionMode = draftMode;
  }
  if (draft.yolo !== baseline.yolo) {
    patch.yolo = draft.yolo;
  }
  if (draft.subagentsEnabled !== baseline.subagentsEnabled) {
    patch.subagentsEnabled = draft.subagentsEnabled;
  }
  if (draft.memoryEnabled !== baseline.memoryEnabled) {
    patch.memoryEnabled = draft.memoryEnabled;
  }
  if (draft.workflowsEnabled !== baseline.workflowsEnabled) {
    patch.workflowsEnabled = draft.workflowsEnabled;
  }
  if (draft.autoWakeEnabled !== baseline.autoWakeEnabled) {
    patch.autoWakeEnabled = draft.autoWakeEnabled;
  }
  if (draft.twoPassCompactionEnabled !== baseline.twoPassCompactionEnabled) {
    patch.twoPassCompactionEnabled = draft.twoPassCompactionEnabled;
  }
  if (draft.lspToolsEnabled !== baseline.lspToolsEnabled) {
    patch.lspToolsEnabled = draft.lspToolsEnabled;
  }
  if (draft.codebaseIndexing !== baseline.codebaseIndexing) {
    patch.codebaseIndexing = draft.codebaseIndexing;
  }
  if (draft.remoteFetch !== baseline.remoteFetch) {
    patch.remoteFetch = draft.remoteFetch;
  }
  return patch;
}

export function hasConfigEditChanges(patch: ConfigEditPatch): boolean {
  return (
    patch.permissionMode != null ||
    patch.yolo != null ||
    patch.subagentsEnabled != null ||
    patch.memoryEnabled != null ||
    patch.workflowsEnabled != null ||
    patch.autoWakeEnabled != null ||
    patch.twoPassCompactionEnabled != null ||
    patch.lspToolsEnabled != null ||
    patch.codebaseIndexing != null ||
    patch.remoteFetch != null
  );
}

/**
 * Snapshot defaults when keys are missing on disk.
 * Defaults match Grok Build docs (workflows/remote_fetch/codebase on; two_pass off).
 */
export function valuesFromSnapshot(snap: {
  permissionMode?: string | null;
  yolo?: boolean | null;
  subagentsEnabled?: boolean | null;
  memoryEnabled?: boolean | null;
  workflowsEnabled?: boolean | null;
  autoWakeEnabled?: boolean | null;
  twoPassCompactionEnabled?: boolean | null;
  lspToolsEnabled?: boolean | null;
  codebaseIndexing?: boolean | null;
  remoteFetch?: boolean | null;
}): ConfigEditValues {
  const mode = normalizePermissionMode(snap.permissionMode ?? null);
  return {
    permissionMode: mode ?? "",
    yolo: snap.yolo ?? false,
    subagentsEnabled: snap.subagentsEnabled ?? true,
    memoryEnabled: snap.memoryEnabled ?? false,
    workflowsEnabled: snap.workflowsEnabled ?? true,
    autoWakeEnabled: snap.autoWakeEnabled ?? true,
    twoPassCompactionEnabled: snap.twoPassCompactionEnabled ?? false,
    lspToolsEnabled: snap.lspToolsEnabled ?? false,
    codebaseIndexing: snap.codebaseIndexing ?? true,
    remoteFetch: snap.remoteFetch ?? true,
  };
}
