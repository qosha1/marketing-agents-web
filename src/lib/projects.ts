/**
 * The project entity (epic startsim-oefxl, lane 1 of the v2 rebuild).
 *
 * A project is NOT a new entity type. It is a row of the existing generic
 * `scope` type with `kind: 'project'` (decision recorded on startsim-oefxl):
 * epic startsim-ux39t already ratified one self-nesting scope primitive, topics
 * and drafts already carry `scope_path`, and the tenant's `?scope=` subtree
 * read and its agent-test-account isolation both key on scope paths.
 *
 *   client            root scope,  kind 'client',  parent ''
 *   project of client child scope, kind 'project', parent '<client path>'
 *   solo project      root scope,  kind 'project', parent ''
 *
 * A project's id is its scope path. This file is pure (no network); the calls
 * live in `projects-api.ts`.
 */
import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';

export const PROJECT_TYPE = 'scope';
export const PROJECT_KIND = 'project';
export const CLIENT_KIND = 'client';

/**
 * Where a project's brief lives. `scope` has no `brief` attribute and adding one
 * is a tenant schema change, so v2 uses the existing longtext `brand_voice`
 * (which already inherits down the scope chain). One constant, so a dedicated
 * attribute later is a one-line change.
 */
export const BRIEF_ATTR = 'brand_voice';

export interface ProjectInput {
  entityType: typeof PROJECT_TYPE;
  name: string;
  data: Record<string, unknown>;
}

function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'project';
}

/** A free scope path for `name` under `clientPath` (or at the root). */
export function projectPath(name: string, clientPath: string | null, taken: string[]): string {
  const base = `${clientPath ?? ''}/${slug(name)}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function buildProjectInput(args: {
  name: string;
  clientPath: string | null;
  takenPaths: string[];
}): ProjectInput {
  const name = args.name.trim();
  if (!name) throw new Error('A project needs a name.');
  const path = projectPath(name, args.clientPath, args.takenPaths);
  return {
    entityType: PROJECT_TYPE,
    name,
    data: { name, kind: PROJECT_KIND, path, parent: args.clientPath ?? '', active: true },
  };
}

/** A tenant with no scopes at all gets one. A tenant with a client but no project does not. */
export function needsDefaultProject(scopeCount: number): boolean {
  return scopeCount === 0;
}

export function defaultProjectInput(account: { name?: string | null; email?: string | null }): ProjectInput {
  const who = account.name?.trim() || account.email?.split('@')[0]?.trim() || '';
  return buildProjectInput({
    name: who ? `${who}'s project` : 'My project',
    clientPath: null,
    takenPaths: [],
  });
}

export interface ProjectRow {
  id: number;
  name: string;
  path: string;
  /** The client's name, or null for a solo project. */
  client: string | null;
  clientPath: string | null;
  brief: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function projectRow(record: EntityRecord, clientsByPath: Map<string, string>): ProjectRow {
  const parent = str(readData(record.data, 'parent')).trim();
  return {
    id: record.id,
    name: str(readData(record.data, 'name')) || record.name,
    path: str(readData(record.data, 'path')),
    client: parent ? (clientsByPath.get(parent) ?? parent) : null,
    clientPath: parent || null,
    brief: str(readData(record.data, BRIEF_ATTR)),
  };
}

/** True when a row's `scope_path` is the project's path or sits under it. Not a prefix match: /x-old is not under /x. */
export function sourcesBelong(rowPath: string | undefined | null, projectPath: string): boolean {
  if (!rowPath) return false;
  return rowPath === projectPath || rowPath.startsWith(`${projectPath}/`);
}

export const PROJECTS_PAGE_SIZE = 25;
/** The "no client" choice in the list's Client filter. */
export const SOLO_CLIENT = '__solo__';

export interface ProjectListQuery {
  search?: string;
  sortBy?: string | null;
  sortDirection?: 'asc' | 'desc';
  clientPath?: string | null;
}

/** Sortable columns -> the attribute the server orders by. Sources has no server value yet. */
const SORT_ATTR: Record<string, string> = { name: 'name', client: 'parent' };

/** The query string for one page of the Projects list. Everything is asked of the server. */
export function projectListFilters(q: ProjectListQuery): Record<string, string> {
  const attr = (q.sortBy && SORT_ATTR[q.sortBy]) || 'name';
  const filters: Record<string, string> = {
    'attr.kind': PROJECT_KIND,
    page_size: String(PROJECTS_PAGE_SIZE),
    order: `${q.sortDirection === 'desc' && q.sortBy && SORT_ATTR[q.sortBy] ? '-' : ''}attr.${attr}`,
  };
  const term = q.search?.trim();
  if (term) filters['attr.name__icontains'] = term;
  if (q.clientPath === SOLO_CLIENT) filters['attr.parent'] = '';
  else if (q.clientPath) filters['attr.parent'] = q.clientPath;
  return filters;
}
