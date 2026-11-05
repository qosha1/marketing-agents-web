/**
 * Active project for v2 (epic startsim-bj3zz, lane 1 = startsim-oefxl).
 *
 * The active project is a scope PATH (a project's id is its path), or null for
 * "All". The sidebar switcher scopes by top-level scope (a client covers its
 * projects, a solo project is its own root) per the wireframe; the stored value
 * is just a path, so switching by individual project later is more options, not
 * a data change (decision bead startsim-xf5q7).
 *
 * `getActiveProjectId()` keeps the signature lanes 2 and 3 import.
 */
import { readData } from '@/lib/board';
import { SCOPE_PATH_ATTR } from '@/lib/scope';
import { CLIENT_KIND, PROJECT_KIND } from '@/lib/projects';
import type { EntityRecord } from '@/lib/foundry-api';

export const ACTIVE_PROJECT_KEY = 'ma.activeProject';
export const CHANGE_EVENT = 'ma:active-project';

export function getActiveProjectId(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveProjectId(path: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (path) window.localStorage.setItem(ACTIVE_PROJECT_KEY, path);
    else window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage blocked: the choice just does not persist.
  }
}

type TypeLike = { key: string; config?: Record<string, unknown> } | undefined;

function declaredPathAttr(type: TypeLike): string | null {
  const scope = (type?.config as { scope?: Record<string, unknown> } | undefined)?.scope;
  const attr = scope?.pathAttribute ?? scope?.path_attribute;
  return typeof attr === 'string' && attr ? attr : null;
}

/** `?scope=` for a type that declares a scope path; nothing for All, unscoped or undeclared types (the tenant answers 400). */
export function scopeFiltersFor(type: TypeLike, active: string | null): Record<string, string> {
  return active && declaredPathAttr(type) ? { scope: active } : {};
}

/** Stamp the active project onto a new record of a scoped type. Never invents or overwrites a path. */
export function stampActiveProject(
  type: TypeLike,
  data: Record<string, unknown>,
  active: string | null,
): Record<string, unknown> {
  if (!active || !declaredPathAttr(type)) return data;
  if (data[SCOPE_PATH_ATTR] || data.scopePath) return data;
  return { ...data, [SCOPE_PATH_ATTR]: active };
}

export interface ProjectChoice {
  path: string;
  label: string;
  /** The client this project is for, or null for a project of your own. */
  clientName: string | null;
}

export interface SwitcherModel {
  /** Projects of your own (no client). */
  solo: ProjectChoice[];
  /** Clients that have at least one project, with those projects. */
  clients: { path: string; name: string; projects: ProjectChoice[] }[];
  /** Every project, in menu order. */
  projects: ProjectChoice[];
  /** Any active client at all: it decides whether the wording and the Client column appear. */
  hasClients: boolean;
}

function textOf(r: EntityRecord, key: string): string {
  const v = readData(r.data, key);
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * What the switcher lists (wireframe C01): projects of your own first, then each
 * client with its projects. Inactive scopes are left out. A project whose parent
 * is not a client is treated as a project of your own, so it can never vanish.
 */
export function switcherModel(scopes: EntityRecord[]): SwitcherModel {
  const live = scopes.filter((r) => readData(r.data, 'active') !== false && textOf(r, 'path'));
  const nameOf = (r: EntityRecord) => textOf(r, 'name') || r.name;
  const clientRows = live.filter((r) => textOf(r, 'kind') === CLIENT_KIND);
  const clientByPath = new Map(clientRows.map((r) => [textOf(r, 'path'), nameOf(r)]));
  const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

  const choices = live
    .filter((r) => textOf(r, 'kind') === PROJECT_KIND)
    .map((r) => ({ path: textOf(r, 'path'), label: nameOf(r), parent: textOf(r, 'parent') }));
  const toChoice = (c: (typeof choices)[number]): ProjectChoice => ({
    path: c.path,
    label: c.label,
    clientName: clientByPath.get(c.parent) ?? null,
  });

  const solo = choices.filter((c) => !clientByPath.has(c.parent)).map(toChoice).sort(byName);
  const clients = clientRows
    .map((r) => ({
      path: textOf(r, 'path'),
      name: nameOf(r),
      projects: choices.filter((c) => c.parent === textOf(r, 'path')).map(toChoice).sort(byName),
    }))
    .filter((c) => c.projects.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    solo,
    clients,
    projects: [...solo, ...clients.flatMap((c) => c.projects)],
    hasClients: clientRows.length > 0,
  };
}

export interface ActiveChoice {
  label: string;
  /** The line above the name: the client, or the word "Project". */
  caption: string;
}

/**
 * Who the active path is, or null when it names nothing that exists any more (a
 * deleted project, a path saved by an older build). Null means the caller should
 * clear it: a stale scope would show empty lists with no explanation.
 */
export function describeActive(scopes: EntityRecord[], model: SwitcherModel, path: string | null): ActiveChoice | null {
  if (!path) return null;
  const project = model.projects.find((p) => p.path === path);
  if (project) return { label: project.label, caption: project.clientName ?? 'Project' };
  const client = scopes.find((r) => textOf(r, 'path') === path && textOf(r, 'kind') === CLIENT_KIND);
  return client ? { label: textOf(client, 'name') || client.name, caption: 'Client' } : null;
}
