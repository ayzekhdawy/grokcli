/** Filter OpenSSH host rows by alias / hostname / user. */

export type SshHostMatchInput = {
  alias: string;
  hostname?: string | null;
  user?: string | null;
};

export function normalizeSshHostQuery(q: string): string {
  return q.trim().toLowerCase();
}

export function matchSshHost(query: string, host: SshHostMatchInput): boolean {
  const q = normalizeSshHostQuery(query);
  if (!q) return true;
  const hay = [host.alias, host.hostname ?? "", host.user ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function mergeWatchingSet(
  persisted: readonly string[],
  pending: Readonly<Record<string, boolean>>,
): Set<string> {
  const set = new Set(persisted);
  for (const [alias, on] of Object.entries(pending)) {
    if (on) set.add(alias);
    else set.delete(alias);
  }
  return set;
}

export function partitionSshHosts<T extends SshHostMatchInput>(
  hosts: readonly T[],
  watching: ReadonlySet<string>,
  query: string,
): { watching: T[]; available: T[] } {
  const watchingRows: T[] = [];
  const availableRows: T[] = [];
  for (const h of hosts) {
    if (!matchSshHost(query, h)) continue;
    if (watching.has(h.alias)) watchingRows.push(h);
    else availableRows.push(h);
  }
  return { watching: watchingRows, available: availableRows };
}
