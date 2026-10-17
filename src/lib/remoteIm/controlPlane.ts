/**
 * IM control plane: /p /r /new and agent mode selection.
 * Pure functions — unit-testable without live Bridge.
 * Spec: docs/llm-wiki/remote-im.md §4
 */

import type {
  ProjectScope,
  RemoteAgentMode,
  RemoteBinding,
  RemoteChannelId,
  SessionIndexEntry,
  TrustedProject,
} from "./types";

export type ControlCommand =
  | { type: "project_list" }
  | { type: "project_select"; query: string }
  | { type: "resume_list" }
  | { type: "resume_select"; query: string }
  | { type: "new_session" }
  | { type: "status" }
  | { type: "whoami" }
  | { type: "stop" }
  | { type: "help" }
  | { type: "cancel" }
  | { type: "user_message"; text: string };

export type ControlUiMode = "idle" | "pick_project" | "pick_session";

export type ControlState = {
  binding: RemoteBinding;
  uiMode: ControlUiMode;
  projects: TrustedProject[];
  sessions: SessionIndexEntry[];
  projectScope: ProjectScope;
  platformUserId?: string;
};

export type ControlEffect =
  | { kind: "reply"; text: string }
  | { kind: "bind_project"; projectId: string; mode: "new" }
  | {
      kind: "bind_session";
      projectId: string;
      sessionId: string;
      agentSessionId: string | null;
      mode: "resume";
    }
  | { kind: "clear_session"; keepProject: boolean }
  | { kind: "agent_turn"; mode: RemoteAgentMode; text: string }
  | { kind: "stop_turn" }
  | { kind: "noop" };

export type ControlResult = {
  state: ControlState;
  effects: ControlEffect[];
};

function allowedProjects(
  projects: TrustedProject[],
  scope: ProjectScope,
): TrustedProject[] {
  if (scope === "all_trusted") return projects;
  const allow = new Set(scope.allow);
  return projects.filter((p) => allow.has(p.id));
}

function matchProject(
  projects: TrustedProject[],
  query: string,
): TrustedProject | null {
  const q = query.trim();
  if (!q) return null;
  const byIndex = Number(q);
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= projects.length) {
    return projects[byIndex - 1] ?? null;
  }
  const lower = q.toLowerCase();
  return (
    projects.find((p) => p.name.toLowerCase() === lower) ||
    projects.find((p) => p.name.toLowerCase().includes(lower)) ||
    projects.find((p) => p.id === q) ||
    null
  );
}

function matchSession(
  sessions: SessionIndexEntry[],
  query: string,
): SessionIndexEntry | null {
  const q = query.trim();
  if (!q) return null;
  const byIndex = Number(q);
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= sessions.length) {
    return sessions[byIndex - 1] ?? null;
  }
  return sessions.find((s) => s.id === q) ?? null;
}

function formatProjectMenu(projects: TrustedProject[]): string {
  if (projects.length === 0) {
    return "No trusted projects available for remote IM.";
  }
  const lines = projects.map((p, i) => `${i + 1}. ${p.name}`);
  return (
    "Select a project (send number or name):\n" +
    lines.join("\n") +
    "\n0. Cancel"
  );
}

function formatSessionMenu(sessions: SessionIndexEntry[]): string {
  if (sessions.length === 0) {
    return "No sessions in this project. Send a message to start a new one.";
  }
  const lines = sessions.map((s, i) => {
    const title = s.title?.trim() || s.id.slice(0, 8);
    return `${i + 1}. ${title}`;
  });
  return (
    "Resume a session (send number):\n" +
    lines.join("\n") +
    "\n0. Cancel"
  );
}

/**
 * Parse raw IM text into a control command.
 * Number replies while in pick mode are handled by the caller via uiMode.
 */
export function parseControlInput(
  text: string,
  uiMode: ControlUiMode,
): ControlCommand {
  const raw = text.trim();
  if (uiMode === "pick_project") {
    if (raw === "0" || /^cancel$/i.test(raw)) return { type: "cancel" };
    return { type: "project_select", query: raw };
  }
  if (uiMode === "pick_session") {
    if (raw === "0" || /^cancel$/i.test(raw)) return { type: "cancel" };
    return { type: "resume_select", query: raw };
  }

  if (raw === "/p" || raw === "/project") return { type: "project_list" };
  const pMatch = /^\/(?:p|project)\s+(.+)$/i.exec(raw);
  if (pMatch) return { type: "project_select", query: pMatch[1]!.trim() };

  if (raw === "/r" || raw === "/resume") return { type: "resume_list" };
  const rMatch = /^\/(?:r|resume)\s+(.+)$/i.exec(raw);
  if (rMatch) return { type: "resume_select", query: rMatch[1]!.trim() };

  if (raw === "/new") return { type: "new_session" };
  if (raw === "/status") return { type: "status" };
  if (raw === "/whoami") return { type: "whoami" };
  if (raw === "/stop") return { type: "stop" };
  if (raw === "/help" || raw === "/h") return { type: "help" };
  if (raw === "0") return { type: "cancel" };

  return { type: "user_message", text: raw };
}

/**
 * Resolve agent mode for a normal user message given current binding.
 * Spec: project bound → new session; resume bound → resume; else reject.
 */
export function resolveMessageMode(
  binding: Pick<RemoteBinding, "projectId" | "agentSessionId" | "pendingMode">,
): RemoteAgentMode {
  if (binding.pendingMode === "reject") return "reject";
  if (!binding.projectId) return "reject";
  if (binding.pendingMode === "resume" && binding.agentSessionId) {
    return "resume";
  }
  if (binding.pendingMode === "new") return "new";
  // After /p: new; after /r: resume; default speaking after project = new
  if (binding.agentSessionId && binding.pendingMode === "resume") {
    return "resume";
  }
  // Bound project, no pending resume → new session for next speak
  if (binding.agentSessionId && binding.pendingMode == null) {
    // Ongoing conversation keeps resume if session already set
    return "resume";
  }
  return "new";
}

/**
 * After project select, next speak is always mode=new (clears agent session).
 */
export function bindingAfterProjectSelect(
  prev: RemoteBinding,
  projectId: string,
): RemoteBinding {
  return {
    ...prev,
    projectId,
    agentSessionId: null,
    pendingMode: "new",
  };
}

/**
 * After resume select, next speak is mode=resume with agentSessionId.
 */
export function bindingAfterResumeSelect(
  prev: RemoteBinding,
  session: SessionIndexEntry,
): RemoteBinding {
  return {
    ...prev,
    projectId: session.projectId ?? prev.projectId,
    agentSessionId: session.agentSessionId ?? session.id,
    pendingMode: "resume",
  };
}

export function bindingAfterNew(prev: RemoteBinding): RemoteBinding {
  return {
    ...prev,
    agentSessionId: null,
    pendingMode: "new",
  };
}

/** sessions_index entry for a remote-started session */
export function remoteSessionSource(channel: RemoteChannelId): string {
  return `remote:${channel}`;
}

/**
 * Drive one control-plane step.
 */
export function applyControlCommand(
  state: ControlState,
  cmd: ControlCommand,
): ControlResult {
  const projects = allowedProjects(state.projects, state.projectScope);
  const effects: ControlEffect[] = [];
  let next: ControlState = { ...state, binding: { ...state.binding } };

  switch (cmd.type) {
    case "project_list": {
      next = { ...next, uiMode: "pick_project" };
      effects.push({ kind: "reply", text: formatProjectMenu(projects) });
      break;
    }
    case "project_select": {
      const p = matchProject(projects, cmd.query);
      if (!p) {
        effects.push({
          kind: "reply",
          text: `Project not found: ${cmd.query}\n` + formatProjectMenu(projects),
        });
        next = { ...next, uiMode: "pick_project" };
        break;
      }
      next = {
        ...next,
        uiMode: "idle",
        binding: bindingAfterProjectSelect(next.binding, p.id),
      };
      effects.push({ kind: "bind_project", projectId: p.id, mode: "new" });
      effects.push({
        kind: "reply",
        text: `Project bound: ${p.name}. Next message starts a new Grok session.`,
      });
      break;
    }
    case "resume_list": {
      if (!next.binding.projectId) {
        effects.push({
          kind: "reply",
          text: "Bind a project first with /p.",
        });
        break;
      }
      const sessions = state.sessions.filter(
        (s) => s.projectId === next.binding.projectId,
      );
      next = { ...next, uiMode: "pick_session", sessions };
      effects.push({ kind: "reply", text: formatSessionMenu(sessions) });
      break;
    }
    case "resume_select": {
      if (!next.binding.projectId) {
        effects.push({
          kind: "reply",
          text: "Bind a project first with /p.",
        });
        break;
      }
      const sessions =
        state.uiMode === "pick_session"
          ? state.sessions
          : state.sessions.filter((s) => s.projectId === next.binding.projectId);
      const s = matchSession(sessions, cmd.query);
      if (!s) {
        effects.push({
          kind: "reply",
          text: `Session not found: ${cmd.query}\n` + formatSessionMenu(sessions),
        });
        next = { ...next, uiMode: "pick_session", sessions };
        break;
      }
      next = {
        ...next,
        uiMode: "idle",
        binding: bindingAfterResumeSelect(next.binding, s),
      };
      effects.push({
        kind: "bind_session",
        projectId: s.projectId ?? next.binding.projectId!,
        sessionId: s.id,
        agentSessionId: s.agentSessionId ?? s.id,
        mode: "resume",
      });
      effects.push({
        kind: "reply",
        text: `Resuming: ${s.title || s.id}.`,
      });
      break;
    }
    case "new_session": {
      if (!next.binding.projectId) {
        effects.push({
          kind: "reply",
          text: "Bind a project first with /p.",
        });
        break;
      }
      next = {
        ...next,
        uiMode: "idle",
        binding: bindingAfterNew(next.binding),
      };
      effects.push({ kind: "clear_session", keepProject: true });
      effects.push({
        kind: "reply",
        text: "Session cleared. Next message starts a new Grok session.",
      });
      break;
    }
    case "status": {
      const b = next.binding;
      effects.push({
        kind: "reply",
        text: [
          `project: ${b.projectId ?? "(none)"}`,
          `session: ${b.agentSessionId ?? "(none)"}`,
          `mode: ${b.pendingMode ?? (b.agentSessionId ? "resume" : "new")}`,
          `chatKey: ${b.chatKey}`,
          `channel: ${b.channel}`,
        ].join("\n"),
      });
      break;
    }
    case "whoami": {
      effects.push({
        kind: "reply",
        text: `user: ${state.platformUserId ?? "(unknown)"}`,
      });
      break;
    }
    case "stop": {
      effects.push({ kind: "stop_turn" });
      effects.push({ kind: "reply", text: "Stop requested." });
      break;
    }
    case "help": {
      effects.push({
        kind: "reply",
        text: [
          "/p — list / bind project (new session)",
          "/r — list / resume App session",
          "/new — new session, keep project",
          "/status — binding status",
          "/stop — interrupt turn",
          "/whoami — platform user id",
          "/help — this help",
        ].join("\n"),
      });
      break;
    }
    case "cancel": {
      next = { ...next, uiMode: "idle" };
      effects.push({ kind: "reply", text: "Cancelled." });
      break;
    }
    case "user_message": {
      const mode = resolveMessageMode(next.binding);
      if (mode === "reject") {
        effects.push({
          kind: "reply",
          text: "No project bound. Use /p to select a trusted project first.",
        });
        effects.push({ kind: "agent_turn", mode: "reject", text: cmd.text });
        break;
      }
      // Clear one-shot pendingMode after first message while keeping binding
      if (next.binding.pendingMode === "new") {
        next = {
          ...next,
          binding: { ...next.binding, pendingMode: null },
        };
      } else if (next.binding.pendingMode === "resume") {
        next = {
          ...next,
          binding: { ...next.binding, pendingMode: null },
        };
      }
      effects.push({ kind: "agent_turn", mode, text: cmd.text });
      break;
    }
    default: {
      effects.push({ kind: "noop" });
    }
  }

  return { state: next, effects };
}

/** Project scope: never accept free filesystem paths */
export function isValidProjectScope(
  scope: ProjectScope,
  trustedIds: Set<string>,
): boolean {
  if (scope === "all_trusted") return true;
  if (!scope || !Array.isArray(scope.allow)) return false;
  return scope.allow.every((id) => typeof id === "string" && trustedIds.has(id));
}

export function emptyBinding(
  chatKey: string,
  channel: RemoteChannelId,
): RemoteBinding {
  return {
    chatKey,
    channel,
    projectId: null,
    agentSessionId: null,
    pendingMode: null,
  };
}
