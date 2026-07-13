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

export function listEntities(type: string, page = 1) {
  return api.client.get<Paginated<EntityRecord>>('api/v1/entities', {
    params: { type, page },
  });
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

/**
 * Fetch every record of a type across pages — the status board groups the full
 * set client-side. Capped so a huge type can't trigger an unbounded fetch.
 */
export async function listAllEntities(type: string, maxPages = 20): Promise<EntityRecord[]> {
  const all: EntityRecord[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await listEntities(type, page);
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

export interface MemberRow {
  id?: string | number;
  email?: string;
  name?: string;
  role?: string;
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
