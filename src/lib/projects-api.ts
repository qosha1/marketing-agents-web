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
  buildClientInput,
  buildProjectInput,
  projectListFilters,
  projectRow,
  type ProjectListQuery,
  type ProjectRow,
} from '@/lib/projects';

export interface ClientOption {
  path: string;
  name: string;
  /** An archived client still names its projects, but is not offered for new ones. */
  active: boolean;
}

export function clientOptions(records: EntityRecord[]): ClientOption[] {
  return records
    .map((r) => ({
      path: String(readData(r.data, 'path') ?? ''),
      name: String(readData(r.data, 'name') ?? r.name),
      active: readData(r.data, 'active') !== false,
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

export async function createProject(args: {
  name: string;
  /** An existing client's path, or null for a project of your own. */
  clientPath: string | null;
  /** Make this client first (the dialog's "New client…"); wins over `clientPath`. */
  newClientName?: string;
}): Promise<EntityRecord> {
  const takenPaths = await listScopePaths();
  let clientPath = args.clientPath;
  if (args.newClientName?.trim()) {
    const client = await createEntity(buildClientInput({ name: args.newClientName, takenPaths }));
    clientPath = String(readData(client.data, 'path') ?? '') || null;
    if (clientPath) takenPaths.push(clientPath);
  }
  return createEntity(buildProjectInput({ name: args.name, clientPath, takenPaths }));
}

export async function loadProject(
  id: number | string,
  clients: ClientOption[] = [],
): Promise<{ record: EntityRecord; row: ProjectRow }> {
  const record = await getEntity(id);
  return { record, row: projectRow(record, new Map(clients.map((c) => [c.path, c.name]))) };
}

/** Move a project to another client (or to none). The path stays: it is the project's id and its content's scope. */
export async function changeProjectClient(record: EntityRecord, clientPath: string | null): Promise<EntityRecord> {
  return updateEntity(record.id, { data: laneMoveData(record.data, 'parent', clientPath ?? '') });
}

export async function saveBrief(record: EntityRecord, brief: string): Promise<EntityRecord> {
  return updateEntity(record.id, { data: laneMoveData(record.data, BRIEF_ATTR, brief) });
}

/**
 * How many sources a project has. `source` is not scoped to a project yet, so
 * every project shares the one set and the count is that set's size; once `source`
 * declares a scope path the count narrows to the project by itself.
 */
export async function countProjectSources(path: string): Promise<number> {
  const types = await listTypes();
  const source = types.results.find((t) => t.key === 'source');
  const scope = (source?.config as { scope?: { pathAttribute?: unknown; path_attribute?: unknown } } | undefined)?.scope;
  const declared = scope?.pathAttribute ?? scope?.path_attribute;
  return declared ? countEntities('source', { scope: path }) : countEntities('source');
}
