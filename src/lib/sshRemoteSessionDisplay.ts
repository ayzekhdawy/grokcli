/** Display helpers for the sidebar SSH remote session rail. */

export const SSH_REMOTE_PAGE_SIZE = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeSessionId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** First non-empty line, collapsed whitespace, capped. */
export function firstSentenceTitle(raw: string, max = 48): string {
  const line =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const collapsed = line.split(/\s+/).join(" ").trim();
  if (!collapsed) return "";
  const chars = [...collapsed];
  if (chars.length <= max) return collapsed;
  return `${chars.slice(0, max - 1).join("")}…`;
}

export function cwdBasename(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function remoteTitleKey(alias: string, id: string): string {
  return `${alias}:${id}`;
}

export function remoteSessionLabel(opts: {
  title: string;
  cwd: string;
  custom?: string | null;
  untitled: string;
}): string {
  const custom = opts.custom?.trim();
  if (custom) return custom;
  const fromRemote = firstSentenceTitle(opts.title);
  if (fromRemote && !looksLikeSessionId(fromRemote)) return fromRemote;
  const base = cwdBasename(opts.cwd);
  if (base && !looksLikeSessionId(base)) return base;
  return opts.untitled;
}

export function remotePathTip(alias: string, cwd: string): string {
  const path = cwd.trim();
  if (!path) return alias;
  return `${alias} · ${path}`;
}

export function remainingRemoteCount(total: number, loaded: number): number {
  return Math.max(0, total - loaded);
}

export function normalizeRemoteCwd(cwd: string): string {
  return cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Join a remote POSIX root with a relative path. Rejects `..`. */
export function joinRemoteRelative(root: string, relative: string): string {
  const base = root.trim().replace(/\/+$/, "");
  const rel = relative.trim().replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  if (!rel || rel === ".") return base;
  const parts = base.split("/").filter(Boolean);
  for (const c of rel.split("/")) {
    if (!c || c === ".") continue;
    if (c === "..") {
      throw new Error("path escapes project root");
    }
    parts.push(c);
  }
  return `/${parts.join("/")}`;
}

/** Folder label: basename, or parent/base when two cwds share a basename. */
export function uniqueCwdLabel(
  cwd: string,
  allCwds: readonly string[],
): string {
  const norm = normalizeRemoteCwd(cwd);
  const base = cwdBasename(norm) || norm || "/";
  let clashes = 0;
  for (const other of allCwds) {
    const otherNorm = normalizeRemoteCwd(other);
    const otherBase = cwdBasename(otherNorm) || otherNorm || "/";
    if (otherBase === base) clashes += 1;
  }
  if (clashes <= 1) return base;
  const parts = norm.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return base;
}

export type RemotePathGroup<T extends { cwd: string } = { cwd: string }> = {
  cwd: string;
  label: string;
  sessions: T[];
};

/** Group a newest-first remote list by cwd. Group order follows first appearance. */
export function groupRemoteSessionsByCwd<T extends { cwd: string }>(
  sessions: readonly T[],
): RemotePathGroup<T>[] {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const s of sessions) {
    const key = normalizeRemoteCwd(s.cwd);
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(s);
  }
  return order.map((key) => ({
    cwd: key,
    label: uniqueCwdLabel(key, order),
    sessions: map.get(key) ?? [],
  }));
}
