/** API domain: project */

import {
  invoke,
} from "./host";

export async function projectsList() {
  return invoke<
    Array<{
      id: string;
      name: string;
      path: string;
      trusted: boolean;
      pathOk: boolean;
      pinned?: boolean;
      /** Legacy flag; retired system:general is no longer listed. */
      system?: boolean;
      sshAlias?: string | null;
    }>
  >("projects_list");
}

/** On-disk default cwd for orphan chats (`{app_data}/workspaces/general`). */
export async function generalWorkspacePath() {
  return invoke<string>("general_workspace_path");
}

export async function projectAdd(path: string, trust: boolean) {
  return invoke("project_add", { path, trust });
}

export async function projectAddSsh(alias: string, path: string, trust: boolean) {
  return invoke<{
    id: string;
    name: string;
    path: string;
    trusted: boolean;
    pathOk: boolean;
    pinned?: boolean;
    sshAlias?: string | null;
  }>("project_add_ssh", { alias, path, trust });
}

/**
 * Persist sidebar project order. Host pin-partitions so unpinned items
 * cannot sit above pinned ones. Returns the final ordered list.
 */
export async function projectsReorder(orderedIds: string[]) {
  return invoke<
    Array<{
      id: string;
      name: string;
      path: string;
      trusted: boolean;
      pathOk: boolean;
      pinned?: boolean;
      system?: boolean;
      color?: string | null;
    }>
  >("projects_reorder", { orderedIds });
}

