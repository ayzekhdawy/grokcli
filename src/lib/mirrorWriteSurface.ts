/**
 * Phone-mirror write surface — categories shown when write is enabled.
 *
 * Keep method ids in sync with `WRITE_METHODS` in
 * `src-tauri/src/mirror/rpc.rs` (read-only gate).
 *
 * When write is on, the host currently allows the full allowlist below
 * (broad surface). UI should list categories and warn that the set is broad.
 * Never includes secrets / tokens / URLs.
 */

/** Stable category id for i18n (`mirror.write.category.<id>`). */
export type MirrorWriteCategoryId =
  | "send"
  | "stop"
  | "sessions"
  | "permissions"
  | "askUser"
  | "plan"
  | "delete"
  | "rename";

export type MirrorWriteCategory = {
  id: MirrorWriteCategoryId;
  /** RPC method(s) that map to this category. */
  methods: readonly string[];
};

/**
 * Allowlisted write methods grouped for the Connect panel.
 * Order is presentation order.
 */
export const MIRROR_WRITE_CATEGORIES: readonly MirrorWriteCategory[] = [
  { id: "send", methods: ["session.send"] },
  { id: "stop", methods: ["session.stop", "session.stopReport"] },
  { id: "sessions", methods: ["session.create"] },
  { id: "permissions", methods: ["session.resolvePermission"] },
  { id: "askUser", methods: ["session.answerAskUser"] },
  { id: "plan", methods: ["session.reviewPlan"] },
  { id: "delete", methods: ["session.delete"] },
  { id: "rename", methods: ["session.rename"] },
] as const;

/** Flat list of write methods (same order as categories). */
export const MIRROR_WRITE_METHODS: readonly string[] =
  MIRROR_WRITE_CATEGORIES.flatMap((c) => c.methods);

/**
 * True when the effective write method set is the full default allowlist
 * (i.e. no finer-grained restriction). Today write-on always means broad.
 */
export function isBroadMirrorWriteSurface(
  methods: readonly string[] = MIRROR_WRITE_METHODS,
): boolean {
  if (methods.length === 0) return false;
  const allowed = new Set(MIRROR_WRITE_METHODS);
  const seen = new Set<string>();
  for (const m of methods) {
    if (!allowed.has(m)) continue;
    seen.add(m);
  }
  return seen.size >= MIRROR_WRITE_METHODS.length;
}

/** i18n key for a write category label. */
export function mirrorWriteCategoryKey(
  id: MirrorWriteCategoryId,
): `mirror.write.category.${MirrorWriteCategoryId}` {
  return `mirror.write.category.${id}`;
}

/** Default max concurrent mirror clients (host default / UI). */
export const MIRROR_DEFAULT_MAX_CLIENTS = 4;
export const MIRROR_MIN_CLIENTS = 1;
export const MIRROR_MAX_CLIENTS_CAP = 16;

/** Clamp max-clients for UI / host API. */
export function normalizeMirrorMaxClients(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return MIRROR_DEFAULT_MAX_CLIENTS;
  return Math.min(
    MIRROR_MAX_CLIENTS_CAP,
    Math.max(MIRROR_MIN_CLIENTS, Math.round(n)),
  );
}
