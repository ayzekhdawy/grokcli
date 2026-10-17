/**
 * Pure map: App permission policy / YOLO / plan mode ↔ Grok CLI `--permission-mode`.
 *
 * CLI values (from `grok --help`):
 *   default | acceptEdits | auto | dontAsk | bypassPermissions | plan
 *
 * Keep in sync with:
 * - `src-tauri/src/acp_client.rs` (`cli_permission_mode` / spawn flags)
 * - `docs/llm-wiki/catalog.md`
 */

import {
  isValidPolicy,
  type PermissionPolicyId,
  type SessionModeOption,
} from "./grokCatalog";

/** Official CLI `--permission-mode` enum. */
export const CLI_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "plan",
] as const;

export type CliPermissionMode = (typeof CLI_PERMISSION_MODES)[number];

export type SessionModeId = SessionModeOption["id"];

/**
 * Product permission policies that map 1:1 onto a distinct CLI mode
 * (excludes `allow_for_session`, which shares CLI `default` with `ask`).
 */
export const CLI_PRIMARY_POLICY_MAP: ReadonlyArray<{
  policy: PermissionPolicyId;
  cli: CliPermissionMode;
}> = [
  { policy: "ask", cli: "default" },
  { policy: "accept_edits", cli: "acceptEdits" },
  { policy: "auto", cli: "auto" },
  { policy: "dont_ask", cli: "dontAsk" },
  { policy: "always_approve", cli: "bypassPermissions" },
];

/** Full App → CLI table (policy only; plan/YOLO applied in {@link resolveCliPermissionMode}). */
export const POLICY_TO_CLI: Readonly<Record<PermissionPolicyId, CliPermissionMode>> = {
  ask: "default",
  accept_edits: "acceptEdits",
  /** Host session allow-list; CLI still uses default ask baseline. */
  allow_for_session: "default",
  auto: "auto",
  dont_ask: "dontAsk",
  always_approve: "bypassPermissions",
};

/** Reverse: CLI mode → product policy (`plan` is session mode → ask policy). */
export const CLI_TO_POLICY: Readonly<Record<CliPermissionMode, PermissionPolicyId>> = {
  default: "ask",
  acceptEdits: "accept_edits",
  auto: "auto",
  dontAsk: "dont_ask",
  bypassPermissions: "always_approve",
  /** Prefer product session mode `plan`; policy stays ask. */
  plan: "ask",
};

export function isCliPermissionMode(raw: string): raw is CliPermissionMode {
  return (CLI_PERMISSION_MODES as readonly string[]).includes(raw);
}

/**
 * Map a single App permission policy id to a CLI `--permission-mode` value.
 * Unknown / empty → `default`.
 */
export function policyToCliPermissionMode(
  policy: string | null | undefined,
): CliPermissionMode {
  const id = (policy ?? "").trim();
  if (!id) return "default";
  if (isValidPolicy(id)) return POLICY_TO_CLI[id];
  // Accept already-CLI strings and common aliases.
  const lower = id.toLowerCase().replace(/[_-]/g, "");
  if (isCliPermissionMode(id)) return id;
  switch (lower) {
    case "default":
    case "ask":
      return "default";
    case "acceptedits":
      return "acceptEdits";
    case "auto":
      return "auto";
    case "dontask":
      return "dontAsk";
    case "bypasspermissions":
    case "alwaysapprove":
    case "always":
    case "yolo":
      return "bypassPermissions";
    case "plan":
      return "plan";
    default:
      return "default";
  }
}

/**
 * Map CLI mode → product permission policy (lossy for `auto` / `plan`).
 */
export function cliPermissionModeToPolicy(
  mode: string | null | undefined,
): PermissionPolicyId {
  const m = (mode ?? "").trim();
  if (isCliPermissionMode(m)) return CLI_TO_POLICY[m];
  // Fall through aliases via policyToCli then reverse.
  const cli = policyToCliPermissionMode(m);
  return CLI_TO_POLICY[cli];
}

export interface ResolveCliPermissionModeInput {
  /** App policy id (ask / accept_edits / …) or CLI alias. */
  policy?: string | null;
  /**
   * Product session mode (`agent` | `plan` | `ask`).
   * When `plan`, CLI gets `--permission-mode plan` unless YOLO wins.
   */
  sessionMode?: string | null;
  /**
   * Explicit YOLO / always-approve override.
   * When true, forces `bypassPermissions` (CLI always-approve wins over auto/plan).
   */
  yolo?: boolean;
}

/**
 * Resolve the effective CLI `--permission-mode` from App policy, YOLO, and plan mode.
 *
 * Precedence (aligned with Grok Build docs):
 * 1. YOLO / `always_approve` → `bypassPermissions`
 * 2. Product session mode `plan` → `plan`
 * 3. Policy table (incl. `auto` alias)
 */
export function resolveCliPermissionMode(
  input: ResolveCliPermissionModeInput,
): CliPermissionMode {
  const policy = (input.policy ?? "").trim();
  const yolo =
    input.yolo === true ||
    policyToCliPermissionMode(policy) === "bypassPermissions" ||
    policy === "always_approve" ||
    /^yolo$/i.test(policy);

  if (yolo) return "bypassPermissions";

  const session = (input.sessionMode ?? "").trim().toLowerCase();
  if (session === "plan") return "plan";

  return policyToCliPermissionMode(policy);
}

/** True when spawn should also pass agent `--always-approve`. */
export function shouldPassAlwaysApprove(mode: CliPermissionMode): boolean {
  return mode === "bypassPermissions";
}

/**
 * Top-level CLI args for permission mode: `["--permission-mode", "<mode>"]`.
 * Always returns both tokens (CLI default is `default` but we pin explicitly).
 */
export function permissionModeSpawnFlags(
  input: ResolveCliPermissionModeInput,
): [string, string] {
  const mode = resolveCliPermissionMode(input);
  return ["--permission-mode", mode];
}

/**
 * Agent-option flags that pair with the permission mode.
 * YOLO → `["--always-approve"]`; otherwise empty.
 */
export function alwaysApproveSpawnFlags(
  input: ResolveCliPermissionModeInput,
): string[] {
  return shouldPassAlwaysApprove(resolveCliPermissionMode(input))
    ? ["--always-approve"]
    : [];
}

/**
 * Whether the product policy ↔ CLI mode relationship is 1:1 for this policy.
 * `allow_for_session` shares CLI `default` with `ask` → not 1:1.
 */
export function isPolicyCliOneToOne(policy: string | null | undefined): boolean {
  const id = (policy ?? "").trim();
  if (!isValidPolicy(id)) return false;
  if (id === "allow_for_session") return false;
  return CLI_PRIMARY_POLICY_MAP.some((row) => row.policy === id);
}

/** Display label for CLI mode (language-neutral token; UI may prefix via i18n). */
export function cliPermissionModeLabel(mode: CliPermissionMode): string {
  return mode;
}
