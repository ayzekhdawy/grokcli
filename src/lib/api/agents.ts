/** API domain: agents */

import {
  invoke,
} from "./host";

export type AgentCatalogEntry = {
  name: string;
  source: string;
  description?: string | null;
  path?: string | null;
};

export type AgentsCatalogResult = {
  agents: AgentCatalogEntry[];
};

export async function agentsCatalog(projectPath?: string | null) {
  return invoke<AgentsCatalogResult>("agents_catalog", {
    projectPath: projectPath ?? null,
  });
}

/** Agent definition row from host `agents_list` (filesystem discovery). */
export type AgentDefDto = {
  name: string;
  path: string;
  /** "project" | "user" | "bundled" */
  scope: string;
  description?: string | null;
};

export type PersonaDefDto = {
  name: string;
  path: string;
  scope: string;
};

export type AgentsListResult = {
  agents: AgentDefDto[];
  personas: PersonaDefDto[];
  userAgentsDir?: string;
  projectAgentsDir?: string | null;
  bundledAgentsDir?: string;
  userPersonasDir?: string;
  projectPersonasDir?: string | null;
  bundledPersonasDir?: string;
};

/** List agent + persona definition files (no CLI required). */
export async function agentsList(projectPath?: string | null) {
  return invoke<AgentsListResult>("agents_list", {
    projectPath: projectPath ?? null,
  });
}

/** Discovered workflow script row from host `workflows_list`. */
export type WorkflowDefDto = {
  name: string;
  path: string;
  scope: string;
};

export type WorkflowsListResult = {
  workflows: WorkflowDefDto[];
  userDir?: string;
  projectDir?: string | null;
  agentHomeDir?: string | null;
  /** Bundled create-workflow skill path (may be missing on disk). */
  createWorkflowSkill?: string;
};

/**
 * Read-only soft-fail discovery of Grok Build workflow `.rhai` files.
 * No CLI required; missing dirs return an empty list.
 */
export async function workflowsList(projectPath?: string | null) {
  return invoke<WorkflowsListResult>("workflows_list", {
    projectPath: projectPath ?? null,
  });
}

/** Soft-fail headless workflow invoke result from host `workflows_run`. */
export type WorkflowRunResultDto = {
  ok: boolean;
  reason: string;
  workflowName: string;
  mode: string;
  log?: string | null;
  truncated?: boolean;
  durationMs?: number;
  cliPath?: string | null;
  cliVersion?: string | null;
  /** Always `headless_workflow_tool` — no top-level `grok workflow` subcommand. */
  invokePath?: string;
};

/**
 * Soft-fail headless run of a registered workflow by name.
 *
 * Host spawns short `grok -p` that must call the agent `workflow` tool
 * (no CLI `workflow` subcommand). Default mode `validate` = validate_only smoke.
 */
export async function workflowsRun(opts: {
  name: string;
  projectPath?: string | null;
  mode?: "validate" | "launch" | string | null;
  timeoutMs?: number | null;
}) {
  return invoke<WorkflowRunResultDto>("workflows_run", {
    name: opts.name,
    projectPath: opts.projectPath ?? null,
    mode: opts.mode ?? "validate",
    timeoutMs: opts.timeoutMs ?? null,
  });
}

/** Result of host `workflows_create` (template `.rhai` write). */
export type WorkflowsCreateResult = {
  name: string;
  path: string;
  scope: string;
  created: boolean;
  overwritten: boolean;
};

/**
 * Create a minimal `.rhai` workflow template under user (`~/.grok/workflows`)
 * or project (`.grok/workflows`). Refuses overwrite unless `force`.
 */
export async function workflowsCreate(opts: {
  name: string;
  scope?: "user" | "project" | string;
  projectPath?: string | null;
  force?: boolean;
}) {
  return invoke<WorkflowsCreateResult>("workflows_create", {
    name: opts.name,
    scope: opts.scope ?? "user",
    projectPath: opts.projectPath ?? null,
    force: opts.force ?? false,
  });
}

export type AgentsScaffoldResult = {
  name: string;
  path: string;
  scope: string;
  created: boolean;
  overwritten: boolean;
};

/**
 * Create `{name}.md` under user GROK_HOME agents or project `.grok/agents`.
 * Rejects overwrite unless `force` is true.
 */
export async function agentsScaffold(opts: {
  name: string;
  scope?: "user" | "project" | string;
  projectPath?: string | null;
  force?: boolean;
  description?: string | null;
}) {
  return invoke<AgentsScaffoldResult>("agents_scaffold", {
    name: opts.name,
    scope: opts.scope ?? "user",
    projectPath: opts.projectPath ?? null,
    force: opts.force ?? false,
    description: opts.description ?? null,
  });
}

