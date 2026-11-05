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

export interface SwitcherOption {
  path: string;
  label: string;
}

/** Top-level scopes: clients, and solo projects (their own root). */
export function switcherOptions(scopes: EntityRecord[]): SwitcherOption[] {
  return scopes
    .filter((r) => {
      const kind = readData(r.data, 'kind');
      const parent = String(readData(r.data, 'parent') ?? '').trim();
      return !parent && (kind === CLIENT_KIND || kind === PROJECT_KIND) && readData(r.data, 'active') !== false;
    })
    .map((r) => ({
      path: String(readData(r.data, 'path') ?? ''),
      label: String(readData(r.data, 'name') ?? r.name),
    }))
    .filter((o) => o.path);
}
