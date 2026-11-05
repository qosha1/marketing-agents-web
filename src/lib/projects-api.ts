/**
 * Network calls for projects (epic startsim-oefxl). The pure rules are in
 * `projects.ts`; everything here goes through the shared tenant client.
 */
import { readData } from '@/lib/board';
import {
  countEntities,
  createEntity,
  getEntity,
  listAllEntities,
  listEntities,
  listTypes,
  updateEntity,
  type EntityRecord,
} from '@/lib/foundry-api';
import { laneMoveData } from '@/lib/board';
import {
  BRIEF_ATTR,
  CLIENT_KIND,
  PROJECT_TYPE,
  buildProjectInput,
  defaultProjectInput,
  needsDefaultProject,
  projectListFilters,
  projectRow,
  type ProjectListQuery,
  type ProjectRow,
} from '@/lib/projects';

export interface ClientOption {
  path: string;
  name: string;
}

export function clientOptions(records: EntityRecord[]): ClientOption[] {
  return records
    .map((r) => ({
      path: String(readData(r.data, 'path') ?? ''),
      name: String(readData(r.data, 'name') ?? r.name),
    }))
    .filter((c) => c.path);
}

export async function listClients(): Promise<ClientOption[]> {
  return clientOptions(await listAllEntities(PROJECT_TYPE, { filters: { 'attr.kind': CLIENT_KIND } }));
}

/** Every scope path in use, so a new project never lands on one. */
export async function listScopePaths(): Promise<string[]> {
  const all = await listAllEntities(PROJECT_TYPE);
  return all.map((r) => String(readData(r.data, 'path') ?? '')).filter(Boolean);
}

export async function listProjectsPage(
  page: number,
  query: ProjectListQuery,
  clients: ClientOption[],
): Promise<{ count: number; rows: ProjectRow[] }> {
  const res = await listEntities(PROJECT_TYPE, page, projectListFilters(query));
  const byPath = new Map(clients.map((c) => [c.path, c.name]));
  return { count: res.count ?? 0, rows: res.results.map((r) => projectRow(r, byPath)) };
}

export async function createProject(args: { name: string; clientPath: string | null }): Promise<EntityRecord> {
  const takenPaths = await listScopePaths();
  return createEntity(buildProjectInput({ ...args, takenPaths }));
}

/** A tenant with no scopes at all is given one project named from the account. */
let defaultInFlight: Promise<EntityRecord | null> | null = null;
export function ensureDefaultProject(account: {
  name?: string | null;
  email?: string | null;
}): Promise<EntityRecord | null> {
  // The rail and the phone drawer both mount a switcher: one creation, not two.
  defaultInFlight ??= createDefaultIfEmpty(account).finally(() => {
    defaultInFlight = null;
  });
  return defaultInFlight;
}

async function createDefaultIfEmpty(account: {
  name?: string | null;
  email?: string | null;
}): Promise<EntityRecord | null> {
  const probe = await listEntities(PROJECT_TYPE, 1, { page_size: '1' });
  if (!needsDefaultProject(probe.count ?? 0)) return null;
  return createEntity(defaultProjectInput(account));
}

export async function loadProject(id: number | string): Promise<{ record: EntityRecord; row: ProjectRow }> {
  const record = await getEntity(id);
  return { record, row: projectRow(record, new Map()) };
}

export async function saveBrief(record: EntityRecord, brief: string): Promise<EntityRecord> {
  return updateEntity(record.id, { data: laneMoveData(record.data, BRIEF_ATTR, brief) });
}

/**
 * How many sources a project has, or null when sources are not scoped to a
 * project yet (`source` is deliberately unscoped today, so the tenant would
 * answer ?scope= with a 400). Lights up by itself once `source` declares a path.
 */
export async function countProjectSources(path: string): Promise<number | null> {
  const types = await listTypes();
  const source = types.results.find((t) => t.key === 'source');
  const scope = (source?.config as { scope?: { pathAttribute?: unknown; path_attribute?: unknown } } | undefined)?.scope;
  const declared = scope?.pathAttribute ?? scope?.path_attribute;
  if (!declared) return null;
  return countEntities('source', { scope: path });
}
