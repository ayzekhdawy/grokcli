/** API domain: automations */

import {
  invoke,
  isTauri,
} from "./host";

// ── Automations (scheduled tasks) ───────────────────────────────────────────

export interface AutomationDto {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  projectId: string | null;
  modelId: string | null;
  effort: string | null;
  frequency: string;
  time: string;
  weekdays: number[];
  notify: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export interface AutomationInputDto {
  title: string;
  prompt: string;
  enabled?: boolean;
  projectId?: string | null;
  modelId?: string | null;
  effort?: string | null;
  frequency?: string;
  time?: string;
  weekdays?: number[];
  notify?: string;
  nextRunAt?: string | null;
}

export async function automationsList(): Promise<AutomationDto[]> {
  if (!isTauri()) {
    const { loadAutomationsLocal } = await import("../automations");
    return loadAutomationsLocal() as AutomationDto[];
  }
  return invoke<AutomationDto[]>("automations_list");
}

export interface AutomationRunnerStatusDto {
  running: boolean;
  lastTickAt?: string | null;
  tickIntervalSecs: number;
  windowRequired: boolean;
  processRequired: boolean;
  enabledCount: number;
  keepTrayForSchedules: boolean;
  /** True when process launched with `--fire-due-schedules` (one-shot). */
  oneshotMode?: boolean;
  honesty: string;
}

export async function automationRunnerStatus(): Promise<AutomationRunnerStatusDto> {
  if (!isTauri()) {
    return {
      running: false,
      lastTickAt: null,
      tickIntervalSecs: 30,
      windowRequired: false,
      processRequired: true,
      enabledCount: 0,
      keepTrayForSchedules: true,
      oneshotMode: false,
      honesty:
        "Schedules tick only while this app process is alive (main window or tray). There is no separate background daemon. Optional one-shot: --fire-due-schedules fires at most one due task then exits.",
    };
  }
  return invoke<AutomationRunnerStatusDto>("automation_runner_status");
}

export interface SchedulesLaunchAgentStatusDto {
  supported: boolean;
  enabled: boolean;
  helperDir?: string | null;
  installedPlist?: string | null;
  installed: boolean;
  appPath?: string | null;
  honesty: string;
}

export async function schedulesLaunchAgentStatus(): Promise<SchedulesLaunchAgentStatusDto> {
  if (!isTauri()) {
    return {
      supported: false,
      enabled: false,
      installed: false,
      honesty:
        "Not a headless daemon. The LaunchAgent only starts the full Grok App.",
    };
  }
  return invoke<SchedulesLaunchAgentStatusDto>("schedules_launch_agent_status");
}

export async function schedulesLaunchAgentSetEnabled(
  enabled: boolean,
): Promise<SchedulesLaunchAgentStatusDto> {
  if (!isTauri()) {
    return schedulesLaunchAgentStatus();
  }
  return invoke<SchedulesLaunchAgentStatusDto>(
    "schedules_launch_agent_set_enabled",
    { enabled },
  );
}

export async function schedulesLaunchAgentRevealHelper(): Promise<string> {
  if (!isTauri()) {
    throw new Error("Desktop only");
  }
  return invoke<string>("schedules_launch_agent_reveal_helper");
}

export async function automationCreate(
  input: AutomationInputDto,
): Promise<AutomationDto> {
  if (!isTauri()) {
    const mod = await import("../automations");
    const list = mod.loadAutomationsLocal();
    const now = new Date().toISOString();
    const draft = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      prompt: input.prompt.trim(),
      enabled: input.enabled ?? true,
      projectId: input.projectId ?? null,
      modelId: input.modelId ?? null,
      effort: input.effort ?? null,
      frequency: input.frequency ?? "daily",
      time: input.time ?? "09:00",
      weekdays: input.weekdays ?? [],
      notify: input.notify ?? "all",
      createdAt: now,
      updatedAt: now,
      lastRunAt: null as string | null,
      nextRunAt:
        input.nextRunAt ??
        mod.computeNextRunAt({
          frequency: input.frequency ?? "daily",
          time: input.time ?? "09:00",
          weekdays: input.weekdays ?? [],
          enabled: input.enabled ?? true,
        }),
    };
    list.unshift(draft);
    mod.saveAutomationsLocal(list);
    return draft as AutomationDto;
  }
  return invoke<AutomationDto>("automation_create", { input });
}

export async function automationUpdate(
  id: string,
  input: AutomationInputDto,
): Promise<AutomationDto> {
  if (!isTauri()) {
    const {
      loadAutomationsLocal,
      saveAutomationsLocal,
      computeNextRunAt,
    } = await import("../automations");
    const list = loadAutomationsLocal();
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error("automation not found");
    const prev = list[idx];
    const next = {
      ...prev,
      title: input.title.trim(),
      prompt: input.prompt.trim(),
      enabled: input.enabled ?? prev.enabled,
      projectId: input.projectId !== undefined ? input.projectId : prev.projectId,
      modelId: input.modelId !== undefined ? input.modelId : prev.modelId,
      effort: input.effort !== undefined ? input.effort : prev.effort,
      frequency: input.frequency ?? prev.frequency,
      time: input.time ?? prev.time,
      weekdays: input.weekdays ?? prev.weekdays,
      notify: input.notify ?? prev.notify,
      updatedAt: new Date().toISOString(),
      nextRunAt:
        input.nextRunAt !== undefined
          ? input.nextRunAt
          : computeNextRunAt({
              frequency: input.frequency ?? prev.frequency,
              time: input.time ?? prev.time,
              weekdays: input.weekdays ?? prev.weekdays,
              enabled: input.enabled ?? prev.enabled,
            }),
    };
    list[idx] = next;
    saveAutomationsLocal(list);
    return next as AutomationDto;
  }
  return invoke<AutomationDto>("automation_update", { id, input });
}

export async function automationSetEnabled(
  id: string,
  enabled: boolean,
): Promise<AutomationDto> {
  if (!isTauri()) {
    const { loadAutomationsLocal, saveAutomationsLocal, computeNextRunAt } =
      await import("../automations");
    const list = loadAutomationsLocal();
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error("automation not found");
    const prev = list[idx];
    const next = {
      ...prev,
      enabled,
      updatedAt: new Date().toISOString(),
      nextRunAt: enabled
        ? computeNextRunAt({ ...prev, enabled: true })
        : null,
    };
    list[idx] = next;
    saveAutomationsLocal(list);
    return next as AutomationDto;
  }
  return invoke<AutomationDto>("automation_set_enabled", { id, enabled });
}

export async function automationMarkRun(
  id: string,
  lastRunAt: string,
  nextRunAt: string | null,
): Promise<AutomationDto> {
  if (!isTauri()) {
    const { loadAutomationsLocal, saveAutomationsLocal } =
      await import("../automations");
    const list = loadAutomationsLocal();
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error("automation not found");
    const next = {
      ...list[idx],
      lastRunAt,
      nextRunAt,
      updatedAt: new Date().toISOString(),
    };
    list[idx] = next;
    saveAutomationsLocal(list);
    return next as AutomationDto;
  }
  return invoke<AutomationDto>("automation_mark_run", {
    id,
    lastRunAt,
    nextRunAt,
  });
}

export async function automationDelete(id: string): Promise<void> {
  if (!isTauri()) {
    const { loadAutomationsLocal, saveAutomationsLocal } =
      await import("../automations");
    const list = loadAutomationsLocal().filter((a) => a.id !== id);
    saveAutomationsLocal(list);
    return;
  }
  return invoke<void>("automation_delete", { id });
}

