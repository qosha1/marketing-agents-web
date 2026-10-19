/**
 * Renaming or moving a scope (bd startsim-kprfu, SCOPE-002).
 *
 * A scope's path IS its identity: every record under it carries that path, every
 * child scope's path starts with it, and its external_id ends with it. The
 * tenant's `POST /entities/<id>/move-scope/` rewrites all of that in one
 * transaction (tenant-starter apps/schema_registry/scope_moves.py). The generic
 * drawer used to PATCH the path like any other field, which changed this one
 * row and left the whole subtree pointing at a path that no longer existed —
 * every scoped read then answered with nothing, and nothing said why.
 *
 * WHICH TYPE IS A CONTAINER is read from the schema, never from a type key: the
 * type that declares BOTH `config.scope.path_attribute` and
 * `config.scope.parent_attribute`. A scoped RECORD (topic, draft) declares only
 * the path attribute — that is where it sits, not a subtree — so its
 * `scope_path` stays an ordinary field.
 */
import { api } from './api';
import { readData } from './board';
import type { EntityRecord, EntityTypeDef } from './foundry-api';

export interface ScopeContainerAttrs {
  /** The attribute holding the scope's own full path, e.g. `path`. */
  path: string;
  /** The attribute mirroring the parent path, e.g. `parent`. */
  parent: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * The path/parent attribute pair when `type` is a scope CONTAINER, else null.
 * Reads both spellings because the shared client camelCases response keys,
 * config included.
 */
export function scopeContainerAttrs(
  type: Pick<EntityTypeDef, 'config'> | null | undefined,
): ScopeContainerAttrs | null {
  const scope = (type?.config as Record<string, unknown> | undefined)?.scope;
  if (!scope || typeof scope !== 'object') return null;
  const s = scope as Record<string, unknown>;
  const path = str(s.path_attribute) ?? str(s.pathAttribute);
  const parent = str(s.parent_attribute) ?? str(s.parentAttribute);
  return path && parent ? { path, parent } : null;
}

/** The scope's current path, or '' when the row carries none. */
export function currentScopePath(record: EntityRecord, attrs: ScopeContainerAttrs): string {
  const v = readData(record.data, attrs.path);
  return v == null ? '' : String(v).trim();
}

/** What a move rewrote, as the tenant reports it. */
export interface ScopeMoveResult {
  moved: {
    from: string;
    to: string;
    scopes: number;
    records: number;
  };
  entity: EntityRecord;
}

/** Move (or rename) a scope and its whole subtree to `to`, a full path. */
export function moveScope(id: EntityRecord['id'], to: string): Promise<ScopeMoveResult> {
  return api.client.post<ScopeMoveResult>(`api/v1/entities/${id}/move-scope`, { to: to.trim() });
}

/** One sentence for what the move did. */
export function describeScopeMove(moved: ScopeMoveResult['moved']): string {
  const scopes = `${moved.scopes} scope${moved.scopes === 1 ? '' : 's'}`;
  const records = `${moved.records} record${moved.records === 1 ? '' : 's'}`;
  return `Moved ${moved.from} to ${moved.to}: ${scopes} and ${records} rewritten.`;
}
