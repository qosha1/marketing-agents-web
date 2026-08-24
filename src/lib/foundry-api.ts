/**
 * Thin typed helpers over the tenant-starter backend's same-origin /api/v1/*
 * endpoints. All requests go through the shared @startsimpli/api client (see
 * ./api), which attaches the central-auth bearer and bounces to signin on 401.
 *
 * Wire-format note: the shared client auto-converts request keys camelCase ->
 * snake_case and response keys snake_case -> camelCase. So we model the contract
 * here in camelCase (entityType, dataType, ...) and the client speaks the
 * Django wire format (entity_type, data_type, ...) for us.
 *
 * CAVEAT: this transform also recurses into the Entity `data` blob. User-chosen
 * attribute keys that aren't plain snake/camel (e.g. with digits or odd casing)
 * can round-trip imperfectly. Keep attribute `name`s simple (snake_case), or
 * lift to a transformKeys:false client if richer keys are needed later.
 */
import type { CollectionClient } from '@startsimpli/ui/collection';

import { api } from './api';

// DRF PageNumberPagination envelope (matches UnifiedTable's page-number model).
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type DataType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'json';

export const DATA_TYPES: { value: DataType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number (decimal)' },
  { value: 'integer', label: 'Whole number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'date', label: 'Date' },
  { value: 'enum', label: 'Choice (pick one)' },
  { value: 'json', label: 'Structured (JSON)' },
];

// Schema ids are UUID strings server-side (number tolerated for legacy/tests).
export type SchemaId = string | number;

export interface AttributeDef {
  id: SchemaId;
  name: string;
  dataType: DataType;
  required: boolean;
  config: Record<string, unknown>;
}

export interface EntityTypeDef {
  id: SchemaId;
  key: string;
  label: string;
  attributes: AttributeDef[];
}

export interface EntityRecord {
  id: number;
  entityType: string;
  externalId: string | null;
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
}

// ---- schema (no-code type modeling) ----

// NOTE on endpoint strings: no leading and no trailing slash — matching the
// @startsimpli/api ENDPOINTS convention (e.g. 'api/v1/contacts'). With baseUrl
// empty (same-origin proxy), the client deliberately does NOT append a trailing
// slash; the Next rewrite (`.../api/:path*/`) adds it. Writing the slash here
// would produce a double slash.

export function listTypes(page = 1) {
  return api.client.get<Paginated<EntityTypeDef>>('api/v1/schema/types', {
    params: { page },
  });
}

export function createType(input: { key: string; label: string }) {
  return api.client.post<EntityTypeDef>('api/v1/schema/types', input);
}

export function createAttribute(input: {
  entityType: SchemaId;
  name: string;
  dataType: DataType;
  required: boolean;
  config?: Record<string, unknown>;
}) {
  return api.client.post<AttributeDef>('api/v1/schema/attributes', {
    config: {},
    ...input,
  });
}

// ---- schema edit/delete (S4) ----
// Path ids carry no trailing slash here (the Next rewrite adds it), matching the
// listTypes/createType convention above.

/** Rename a type's label. The key is immutable server-side (entities reference it). */
export function updateType(id: SchemaId, input: { label: string }) {
  return api.client.patch<EntityTypeDef>(`api/v1/schema/types/${id}`, input);
}

/** Delete a type. The backend returns 409 if records still use it. */
export function deleteType(id: SchemaId) {
  return api.client.delete(`api/v1/schema/types/${id}`);
}

export function updateAttribute(
  id: SchemaId,
  input: {
    name: string;
    dataType: DataType;
    required: boolean;
    config?: Record<string, unknown>;
  },
) {
  return api.client.patch<AttributeDef>(`api/v1/schema/attributes/${id}`, input);
}

export function deleteAttribute(id: SchemaId) {
  return api.client.delete(`api/v1/schema/attributes/${id}`);
}

// ---- relationship defs (typed edges between types, S5) ----

export interface RelationshipDef {
  id: SchemaId;
  key: string;
  sourceType: SchemaId;
  targetType: SchemaId;
}

export function listRelationshipDefs(page = 1) {
  return api.client.get<Paginated<RelationshipDef>>('api/v1/schema/relationships', {
    params: { page },
  });
}

export function createRelationshipDef(input: {
  key: string;
  sourceType: SchemaId;
  targetType: SchemaId;
}) {
  return api.client.post<RelationshipDef>('api/v1/schema/relationships', input);
}

export function deleteRelationshipDef(id: SchemaId) {
  return api.client.delete(`api/v1/schema/relationships/${id}`);
}

// ---- entity instances ----

/**
 * Server-side narrowing understood by the tenant backend's EntityQuery
 * (tenant-starter apps/api/filters.py): `attr.<name>__<op>=<value>`, where op is
 * one of exact/in/gt/gte/lt/lte/icontains/isnull. VERIFIED live against
 * marketing-agents 2026-08-24 — `attr.published_at__gte=2026-08-10` returns
 * 1,135 of 4,116, and `attr.status=surfaced` returns 31.
 *
 * These go into the URL as a raw query string rather than through the shared
 * client's `params`, because that layer rewrites request keys between camel and
 * snake case and `attr.published_at__gte` is neither.
 *
 * CAVEAT, measured: the DEPLOYED tenant image SILENTLY IGNORES a parameter it
 * does not recognise (`?bogus_param=1` returns all 4,116 rather than a 400).
 * So an unsupported filter reads as "no filter", never as an error — only send
 * filters this comment says are verified.
 */
export type EntityFilters = Record<string, string>;

function withFilters(path: string, filters: EntityFilters | undefined): string {
  const entries = Object.entries(filters ?? {});
  if (entries.length === 0) return path;
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

export function listEntities(type: string, page = 1, filters?: EntityFilters) {
  return api.client.get<Paginated<EntityRecord>>(withFilters('api/v1/entities', filters), {
    params: { type, page },
  });
}

/**
 * How many records of a type match `filters`, without fetching any of them.
 *
 * `page_size=1` so the answer costs one row plus the COUNT. Used to say how many
 * records a board's recency window is holding back — a number that has to come
 * from the server, because the client never fetched the ones it is reporting.
 */
export async function countEntities(type: string, filters?: EntityFilters): Promise<number> {
  const res = await listEntities(type, 1, { ...filters, page_size: '1' });
  return res.count ?? 0;
}

/** Fetch a single entity record by id. Path carries no trailing slash (the Next
 * rewrite adds it), matching the listEntities/updateEntity convention. */
export function getEntity(id: number | string) {
  return api.client.get<EntityRecord>(`api/v1/entities/${id}`);
}

export function createEntity(input: {
  entityType: string;
  name: string;
  data: Record<string, unknown>;
}) {
  return api.client.post<EntityRecord>('api/v1/entities', input);
}

/**
 * Patch an entity's name and/or data blob. NOTE: the backend PATCH REPLACES the
 * whole `data` blob with what you send (it does not deep-merge) — so callers must
 * send the FULL merged data, not just the changed keys, or untouched attributes
 * are dropped. (Server-side deep-merge is the /entities/upsert/ endpoint.)
 */
export function updateEntity(
  id: number | string,
  input: { name?: string; data?: Record<string, unknown> },
) {
  return api.client.patch<EntityRecord>(`api/v1/entities/${id}`, input);
}

export function deleteEntity(id: number | string) {
  return api.client.delete(`api/v1/entities/${id}`);
}

/** One lane's slice of the board: what is loaded, and how much there is. */
export interface EntityPageSlice {
  records: EntityRecord[];
  /** The lane's TRUE size on the server, from the DRF envelope — not what loaded. */
  count: number;
  /** Whether a further page exists beyond the ones fetched. */
  hasMore: boolean;
}

/**
 * Fetch pages 1..`pageCount` of a filtered slice (bd startsim-wn2p.27).
 *
 * This is what a board LANE calls. It stops the moment the backend says there is
 * no `next`, so asking for four pages of a lane that holds twenty-three records
 * costs one request, not four — which matters because every lane on the board
 * runs this on mount and most of them are short.
 *
 * Pages are walked in order rather than in parallel: the backend orders by
 * `-created_at, id` and page N+1 is defined relative to page N, so firing them
 * at once buys little and risks a torn read if a row lands mid-walk.
 */
export async function fetchEntityPages(
  type: string,
  filters: EntityFilters | undefined,
  pageCount: number,
  pageSize: number,
): Promise<EntityPageSlice> {
  const withSize: EntityFilters = { ...filters, page_size: String(pageSize) };
  const records: EntityRecord[] = [];
  let count = 0;
  let hasMore = false;
  for (let page = 1; page <= Math.max(1, pageCount); page++) {
    const res = await listEntities(type, page, withSize);
    count = res.count ?? count;
    records.push(...res.results);
    hasMore = Boolean(res.next);
    if (!hasMore) break;
  }
  return { records, count, hasMore };
}

export interface ListAllOptions {
  /** Hard cap on pages walked. The bound is real: hitting it TRUNCATES. */
  maxPages?: number;
  /** Rows per request. Fewer round trips; the backend accepts up to 200. */
  pageSize?: number;
  /** Server-side narrowing — see {@link EntityFilters}. */
  filters?: EntityFilters;
}

/**
 * Fetch every record of a type across pages — the status board groups the full
 * set client-side. Capped so a huge type can't trigger an unbounded fetch.
 *
 * THE CAP IS A SILENT TRUNCATION, and that is why `filters` exists. At the old
 * 20 pages x 50 rows the news_item board fetched the newest 1,000 of 4,116 in 20
 * sequential round trips (~7s before a single card rendered) and then reported
 * "1,000 records" as though that were the whole type. Narrow server-side first;
 * the cap is the backstop, not the plan. `pageSize` 200 also cuts the round
 * trips by 4x for whatever is still fetched in full.
 */
export async function listAllEntities(
  type: string,
  optsOrMaxPages: ListAllOptions | number = {},
): Promise<EntityRecord[]> {
  const opts: ListAllOptions =
    typeof optsOrMaxPages === 'number' ? { maxPages: optsOrMaxPages } : optsOrMaxPages;
  // 50 x 200 = 10,000. The live ceiling is news_item at 4,116, so an unwindowed
  // "All" now genuinely reaches the end of the type instead of stopping 116 rows
  // short of it — and the caller still reports anything the cap does hold back.
  const { maxPages = 50, pageSize = 200, filters } = opts;
  const withSize: EntityFilters = { ...filters, page_size: String(pageSize) };
  const all: EntityRecord[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await listEntities(type, page, withSize);
    all.push(...res.results);
    if (!res.next) break;
  }
  return all;
}

// ---- relationship instances (typed edges between entity records, S5) ----

/**
 * An edge between two entity records. `source`/`target` are Entity ids; the
 * shared client camelCases the wire `rel_type` -> `relType`. E.g. a draft's
 * `written_for` edge to the topic it was written for is
 * `{ relType: 'written_for', source: <draftId>, target: <topicId> }`.
 */
export interface RelationshipRecord {
  id: number;
  relType: string;
  source: number;
  target: number;
}

export function listRelationships(page = 1) {
  return api.client.get<Paginated<RelationshipRecord>>('api/v1/relationships', {
    params: { page },
  });
}

/**
 * The tenant-API surface the shared @startsimpli/ui/collection review workspaces
 * consume — this app's authed same-origin client, injected so the workspaces stay
 * app-agnostic (the ~10-LOC wrappers in page.tsx / drafts/page.tsx pass it in).
 */
export const collectionClient: CollectionClient = { listTypes, listAllEntities, updateEntity };

// ---- tags (generic entity classification, startsim-iegx) ----
// A tag is just {entity, label} — no category/taxonomy, so any UI (the "good
// example" toggle, or a future tag picker) works for ANY entity type. The
// backend has no `?entity=` filter yet, so a caller fetches the (bounded) full
// set and filters client-side, same pattern as listAllRelationships above.

export interface TagRecord {
  id: SchemaId;
  entity: number;
  label: string;
  createdAt: string;
}

export function listTags(page = 1) {
  return api.client.get<Paginated<TagRecord>>('api/v1/tags', { params: { page } });
}

/** Every tag in the org across pages (capped) — see the module note above. */
export async function listAllTags(maxPages = 20): Promise<TagRecord[]> {
  const all: TagRecord[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await listTags(page);
    all.push(...res.results);
    if (!res.next) break;
  }
  return all;
}

export function createTag(input: { entity: number | string; label: string }) {
  return api.client.post<TagRecord>('api/v1/tags', input);
}

export function deleteTag(id: SchemaId) {
  return api.client.delete(`api/v1/tags/${id}`);
}

// ---- identity + org directory (proxied from central by the backend, R9) ----

export interface WhoAmI {
  sub: string;
  email: string;
  companyId: string;
  orgId: string;
  role: string;
}

export function whoami() {
  return api.client.get<WhoAmI>('api/v1/whoami');
}

export interface OrgRow {
  id?: string | number;
  slug?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * A roster row from the central `MemberSerializer` (`{id, org, user: {sub,
 * email}, role, created_at}`, camelCased on arrival). No top-level `email` —
 * central nests identity under `user`, and there is no `name` field at all
 * (see lib/roster.ts, which reads this shape correctly).
 */
export interface MemberRow {
  id?: string | number;
  org?: string;
  user?: { sub?: string; email?: string };
  role?: string;
  createdAt?: string;
  [key: string]: unknown;
}

/** GET /api/v1/org/ — the fork's own org(s), proxied from central. */
export function orgDirectory(search?: string) {
  return api.client.get<OrgRow[] | Paginated<OrgRow>>('api/v1/org', {
    params: search ? { search } : undefined,
  });
}

/**
 * GET /api/v1/org/members/ (all) or /api/v1/org/<slug>/members/ (one org),
 * proxied from central. Deliberately NOT @startsimpli/auth useMembership —
 * that targets central directly, not this fork's scoped view.
 */
export function orgMembers(orgSlug?: string) {
  const path = orgSlug
    ? `api/v1/org/${encodeURIComponent(orgSlug)}/members`
    : 'api/v1/org/members';
  return api.client.get<MemberRow[] | Paginated<MemberRow>>(path);
}
