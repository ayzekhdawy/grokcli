/**
 * Maps UI terminal tab ids → host PTY session ids.
 * Close/cap/project-switch kill through this table so a hidden persist
 * host cannot leave a shell running after the chip is gone.
 */

import * as api from "@/lib/api";

const sessions = new Map<string, string>();

export function registerTerminalPtySession(
  tabId: string,
  sessionId: string,
): void {
  const id = tabId.trim();
  const sid = sessionId.trim();
  if (!id || !sid) return;
  sessions.set(id, sid);
}

export function peekTerminalPtySession(tabId: string): string | null {
  return sessions.get(tabId) ?? null;
}

/** Remove and return the host session id. Does not kill. */
export function takeTerminalPtySession(tabId: string): string | null {
  const sid = sessions.get(tabId) ?? null;
  sessions.delete(tabId);
  return sid;
}

type KillFn = (sessionId: string) => Promise<unknown>;

function defaultKill(sessionId: string): Promise<unknown> {
  return api.terminalPtyKill(sessionId);
}

/** Host kill + forget. Idempotent if the tab was never registered. */
export async function killTerminalPtySession(
  tabId: string,
  kill: KillFn = defaultKill,
): Promise<void> {
  const sid = takeTerminalPtySession(tabId);
  if (!sid) return;
  await kill(sid).catch(() => undefined);
}

export async function killTerminalPtySessions(
  tabIds: readonly string[],
  kill: KillFn = defaultKill,
): Promise<void> {
  const ids = tabIds.filter((id) => sessions.has(id));
  await Promise.all(ids.map((id) => killTerminalPtySession(id, kill)));
}
