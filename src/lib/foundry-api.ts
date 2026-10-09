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
 * THE TRANSFORM ALSO RECURSES INTO THE ENTITY `data` BLOB, which is not an API
 * contract but whatever attribute names the tenant declared — and the pair is not
 * an involution. See the wire-safety section below `listAllEntities`: `source_1`
 * reaches a component as `source1` and cannot be turned back, so every whole-blob
 * write used to RENAME the declared attribute. `updateEntity`/`createEntity` now
 * repair that on the way out; nothing else in the app has to think about it.
 */
import type { RecordPermissions } from '@startsimpli/ui/foundry';
import { readScopeAccess, type ScopeAccess } from '@startsimpli/ui';
import type { CollectionClient } from '@startsimpli/ui/collection';
import {
  preconditionFor,
  versionFromRecord,
  type ConditionalWriteClient,
  type ConditionalWriteOutcome,
  type PreconditionSpelling,
} from '@startsimpli/ui/history';
import { ApiException } from '@startsimpli/api';

import { api } from './api';
import { heldVersion, rememberVersion, rememberVersions } from './record-version';

// DRF PageNumberPagination envelope (matches UnifiedTable's page-number model).
//
// The tenant ADDS keys to this envelope rather than changing it (tenant-starter
// `apps/api/pagination.py`), so anything here beyond the DRF four is present
// only when the backend had something to say about the request. `scopeAccess`
// is the one this app reads: when the org gates a type by `scope` and the
// caller is not exempt, it names the gated types and the scopes the caller
// holds — which is the difference between "there is nothing here" and "you were
// granted nothing", two answers that are otherwise the same `count: 0`.
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
  scopeAccess?: ScopeAccess;
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
  /** What the caller may do to this record, from the tenant (bd startsim-768w.71;
   *  `can()` in `@startsimpli/ui/foundry`). Absent on a tenant that has not rolled. */
  permissions?: RecordPermissions | null;
  entityType: string;
  externalId: string | null;
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
  /**
   * The row's revision count — READ-ONLY, and the token every conditional write
   * asserts (bd startsim-3c2wc). 1-based and gapless; it reads `0` on a record
   * that predates the revision trail, and 0 is a version the server accepts
   * back, so `if (version)` is a bug that unguards exactly the oldest records.
   *
   * ABSENT on a tenant build that predates the trail, which is why nothing here
   * requires it: see lib/record-version.ts for the fail-toward-unguarded
   * posture. Sending it in a request body is IGNORED by the backend — the
   * precondition spellings are `If-Match` and `expected_version`.
   */
  version?: number;
  /**
   * Who the backend recorded as the row's owner. A service credential looks like
   * `svc:n8n-ogmc`; a person is their central-auth user id. Every list/detail
   * response carries it (wire `owner_sub`), and it is half of what
   * lib/draft-origin.ts reads to say where a record came from.
   */
  ownerSub?: string | null;
  /**
   * The backend's per-field "this was set through the GET-then-write endpoints"
   * marks, shaped `{ data: { <field>: { at, sub } } }` (wire `human_edited`).
   * An ENDPOINT distinction, not a claim about who typed the value — see
   * lib/draft-origin.ts.
   */
  humanEdited?: Record<string, unknown> | null;
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

export async function listEntities(type: string, page = 1, filters?: EntityFilters) {
  const res = await api.client.get<Paginated<EntityRecord>>(
    withFilters('api/v1/entities', filters),
    { params: { type, page } },
  );
  // Every row's version, so a write issued from a table, a board or a drawer
  // asserts the version the reader was looking at — see lib/record-version.ts.
  rememberVersions(res?.results);
  return res;
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

export interface ScopeProbe {
  /** The `scope_access` report, or `null` on a tenant that gates nothing. */
  access: ScopeAccess | null;
  /**
   * How many records of `type` this caller may read AT ALL, before any filter
   * this page applies. `0` alongside a report is the blackout shape.
   */
  readableCount: number;
}

/**
 * WHY A LIST OF `type` MIGHT BE EMPTY FOR THIS CALLER (bd startsim-44bar).
 *
 * Its own unfiltered request, for two reasons that both matter.
 *
 * THE REPORT RIDES ON THE ENVELOPE, and the paths that matter here have no
 * envelope left to read: every view on /t/draft and /t/topic is `needAll`, and
 * `listAllEntities` walks the pages and returns a bare array. Reading the
 * report off the list the page already has would fix the types nobody reported
 * this on and leave the two that were reported exactly as they are.
 *
 * AND THE COUNT HAS TO BE UNFILTERED. The question the reader needs answered is
 * "can I reach any of these at all", not "did this view match" — the second is
 * a filter's doing and hanging a permissions notice on it is a nag.
 *
 * NOT `/api/v1/whoami/`, which also carries the report in tenant-starter's
 * current source: VERIFIED against the live marketing-agents tenant 2026-09-17,
 * the DEPLOYED image answers whoami WITHOUT it while its list envelopes carry
 * it. The envelope is the half that is actually on the fleet.
 */
export async function fetchScopeAccess(type: string): Promise<ScopeProbe> {
  const res = await listEntities(type, 1, { page_size: '1' });
  return { access: readScopeAccess(res), readableCount: res.count ?? 0 };
}

/** Fetch a single entity record by id. Path carries no trailing slash (the Next
 * rewrite adds it), matching the listEntities/updateEntity convention. */
export async function getEntity(id: number | string) {
  const record = await api.client.get<EntityRecord>(`api/v1/entities/${id}`);
  rememberVersion(id, record);
  return record;
}

export async function createEntity(input: {
  entityType: string;
  name: string;
  data: Record<string, unknown>;
}) {
  // Same re-keying as updateEntity — a record created through the app must not be
  // born with a renamed attribute. See the wire-safety section below.
  const data = await wireSafeData(input.data);
  const created = await api.client.post<EntityRecord>('api/v1/entities', {
    ...input,
    ...(data ? { data } : {}),
  });
  // No precondition on a CREATE — there is no prior version to assert — but the
  // version it was born at is what guards the first write that follows it.
  if (created?.id !== undefined && created?.id !== null) rememberVersion(created.id, created);
  return created;
}

// ---- wire-safe data blobs (bd startsim-8hgmq.18) --------------------------
//
// THE DEFECT. The shared client's key transform is not an involution:
//
//   snake -> camel: /_([a-z0-9])/ -> uppercase   so  source_1 -> source1
//   camel -> snake: /[A-Z]/       -> _lowercase  so  source1  -> source1
//
// Uppercasing a DIGIT is a no-op, so an underscore that sat before a digit is
// destroyed on the way IN and there is no hump to split on on the way OUT.
// `team_verdict` survives only because `teamVerdict` has one. The backend PATCH
// REPLACES `data`, so EVERY surface here sends the whole blob back — and every
// one of them therefore renamed the declared topic attribute `source_1` to the
// undeclared `source1`. Nothing looked broken, because `readData` tries both
// spellings; what breaks is everything OUTSIDE the browser — `attr.source_1=`
// server-side filtering (which this tenant answers by matching NOTHING, silently
// — see EntityFilters above), `redenormalize_attributes`, and the n8n nodes that
// read the attribute by name. Measured on the live tenant 2026-09-09: 26 of 84
// topics already renamed, 50 more one write away from it.
//
// THE FIX IS NOT TO CAMELISE HARDER. camelToSnake is the IDENTITY on a pure
// snake_case key — `source_1` -> `source_1`, `team_verdict` -> `team_verdict` —
// so a blob keyed by the DECLARED names round-trips exactly, with no change to
// the shared client and no change for any other app.
//
// WHY IT IS NETTED HERE rather than at each surface. The surface corrupting rows
// today is @startsimpli/ui's ReviewDrawer, which this app consumes as a PUBLISHED
// package: a fix there is not consumable here until it is published and the
// dependency bumped. This is the one seam every write in this app passes through,
// including the writes inside @startsimpli/ui, so the corruption stops on this
// app's next deploy at whatever version of the package is installed. The
// type-aware fix ships in the package too — this is the layer below it, not a
// second copy of it.

/** The spelling the shared client produces from a wire key. */
function toCamelKey(name: string): string {
  return name.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** The spelling the shared client sends to the wire for a key. */
function toWireKey(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

let aliasIndex: Promise<Map<string, string>> | null = null;

/**
 * `camel alias -> declared name`, for every declared attribute in the tenant
 * whose camel spelling can no longer be turned back into it. On this tenant that
 * is exactly `{source1: source_1, source2: source_2, source3: source_3}`.
 *
 * TWO GUARD RAILS, both deliberate:
 *
 *  - ONLY DECLARED NAMES. A key the schema never declared is left exactly as it
 *    arrived, because there is no wire spelling to restore it to.
 *  - AMBIGUITY IS SKIPPED. If two declared names collapse onto one camel alias,
 *    neither is restored: a coin flip between two attributes is worse than the
 *    rename. Verified 2026-09-09 — no such collision exists on this tenant.
 *
 * THE INDEX IS TENANT-WIDE, not per type, because {@link updateEntity} is handed
 * an id and not a type. That is a real (if narrow) imprecision: an UNDECLARED key
 * on type B that happens to spell a lossy alias of a declared name on type A
 * would be renamed. Measured on the live tenant: zero blob keys of that shape
 * exist outside the topic type, across 5,655 news_item / 156 draft / 55 source /
 * 1 scope / 1 client rows. @startsimpli/ui does the same restore with the type in
 * hand and has no such gap.
 *
 * Fetched once and cached. A schema fetch that FAILS yields an empty index, so
 * the write goes out unchanged — no worse than the behaviour this replaces, and
 * never a blocked save.
 *
 * A FAILURE IS NOT CACHED, and that distinction is the whole guard. This net is
 * the only thing standing between a decision and a renamed attribute until the
 * shared package is published and bumped here; memoising one transient 500 would
 * switch it off for the life of the tab and every write after it would corrupt
 * exactly as before — silently, which is how this defect got a four-day head
 * start in the first place. So the cached promise is CLEARED on the way out of
 * the catch and the next write tries again.
 */
async function declaredAliasIndex(): Promise<Map<string, string>> {
  aliasIndex ??= (async () => {
    const index = new Map<string, string>();
    const ambiguous = new Set<string>();
    try {
      for (let page = 1; page <= 20; page++) {
        const res = await listTypes(page);
        for (const type of res.results ?? []) {
          for (const attr of type.attributes ?? []) {
            const name = attr.name;
            const camel = toCamelKey(name);
            if (toWireKey(camel) === name) continue; // survives the round trip already
            const seen = index.get(camel);
            if (seen !== undefined && seen !== name) ambiguous.add(camel);
            index.set(camel, name);
          }
        }
        if (!res.next) break;
      }
    } catch {
      // The assignment above has already landed (this runs after an await), so
      // clearing it here is what makes the next write retry instead of inheriting
      // a permanently-empty index.
      aliasIndex = null;
      return new Map<string, string>();
    }
    for (const camel of ambiguous) index.delete(camel);
    return index;
  })();
  return aliasIndex;
}

/** Drop the cached schema index. Tests only — the schema does not change at runtime. */
export function resetDeclaredAliasIndex(): void {
  aliasIndex = null;
}

/**
 * Re-key an outgoing `data` blob so every declared attribute reaches the tenant
 * under its declared name — and so a row that was ALREADY renamed is repaired by
 * the next write rather than having the bad key re-minted.
 *
 * The declared spelling wins when a body somehow carries both: two keys that
 * camelToSnake collapses onto one wire key would otherwise let insertion order
 * pick the survivor.
 */
async function wireSafeData(
  data: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!data) return data;
  const index = await declaredAliasIndex();
  if (index.size === 0) return data;
  const out: Record<string, unknown> = { ...data };
  for (const [camel, name] of index) {
    const hasCamel = Object.prototype.hasOwnProperty.call(out, camel);
    const hasDeclared = Object.prototype.hasOwnProperty.call(out, name);
    if (!hasCamel && !hasDeclared) continue;
    const value = hasDeclared ? out[name] : out[camel];
    delete out[camel];
    out[name] = value;
  }
  return out;
}

/**
 * Patch an entity's name and/or data blob. NOTE: the backend PATCH REPLACES the
 * whole `data` blob with what you send (it does not deep-merge) — so callers must
 * send the FULL merged data, not just the changed keys, or untouched attributes
 * are dropped. (Server-side deep-merge is the /entities/upsert/ endpoint.)
 *
 * BECAUSE IT REPLACES, the blob is re-keyed to the declared attribute names on
 * the way out — see {@link wireSafeData}. That is a repair as well as a guard: a
 * row already holding `source1` goes back as `source_1`.
 *
 * AND IT CARRIES A VERSION PRECONDITION (bd startsim-j19hf, server bd
 * startsim-3c2wc). Sending the whole blob is still last-write-wins over every
 * field — so the fix for two reviewers colliding (bd startsim-m7fdm.2) is not to
 * stop sending the blob, it is to assert WHICH version of the row the blob was
 * merged over and let the server refuse a stale one. The version comes from ONE
 * source per request, never two, chosen in {@link preconditionOf}: the caller's
 * own `precondition` (the draft page, through `useConditionalSave`), else the
 * version of the record the blob was merged over (`basedOn`), else the version
 * lib/record-version.ts last saw for this id. See {@link EntityWriteOptions}.
 */
export async function updateEntity(
  id: number | string,
  input: { name?: string; data?: Record<string, unknown> },
  opts?: EntityWriteOptions,
) {
  const data = await wireSafeData(input.data);
  const guard = preconditionOf(id, opts);
  const saved = await api.client.patch<EntityRecord>(
    `api/v1/entities/${id}`,
    { ...input, ...(data ? { data } : {}), ...guard.body },
    Object.keys(guard.headers).length > 0 ? { headers: guard.headers } : undefined,
  );
  // The response is the freshest version that exists, and it is what guards the
  // NEXT save — which is what lets a 1,200 ms autosave stay guarded without a
  // GET between every write.
  rememberVersion(id, saved);
  return saved;
}

/** Which spelling every write in this app sends.
 *
 *  `header` (`If-Match`) is the design default and leaves the request body
 *  completely untouched, so there is no path by which a precondition can end up
 *  stored on the record. It survives this app's route to Django — browser ->
 *  Next rewrite -> tenant nginx -> DRF — which was verified by sending a
 *  deliberately stale validator through the whole chain and getting a 412 rather
 *  than a 200 (a 200 is what a stripped header looks like, and it is silent).
 *  `body` is the fallback the server provides for a proxy that strips it. */
const PRECONDITION_SPELLING: PreconditionSpelling = 'header';

export interface EntityWriteOptions {
  /**
   * The precondition this write will carry, already built by the caller.
   *
   * SUPPLYING IT — EVEN EMPTY — MEANS THE CALLER OWNS THE GUARD, and the
   * registry contributes nothing. That is the whole point: `preconditions.
   * enforce` checks BOTH `If-Match` and `expected_version` and refuses if
   * EITHER disagrees, so a request carrying a caller's validator beside a
   * registry-derived one would refuse ITSELF with a 412 that looks exactly like
   * a real conflict. One source per request, decided by this one `if`.
   */
  precondition?: {
    headers?: Record<string, string>;
    /** Merged at the TOP LEVEL of the body, never inside `data`. */
    body?: Record<string, unknown>;
  };
  /**
   * The record this write's blob was MERGED OVER — its version is the one to
   * assert (bd startsim-jkkn7.19).
   *
   * WHY THE REGISTRY IS NOT ENOUGH ON ITS OWN. lib/record-version.ts holds the
   * version of the LAST read of an id, and every list refetch moves it. A caller
   * that merges onto a record it is holding — a drawer's snapshot, a board card,
   * a pre-flight `getEntity` — owns a blob that is exactly as old as ITS read,
   * not as old as the newest one. Asserting the registry there pairs an old blob
   * with a newer version, the server accepts it, and whatever landed in between
   * is erased with a 200. The version that belongs on the request is the one
   * that travelled with the blob, so a caller that has it passes it here.
   *
   * A record without a readable version (a tenant build that predates the
   * trail) falls back to the registry, which then holds nothing either.
   * Ignored when `precondition` is given: that caller owns the guard outright.
   */
  basedOn?: { version?: unknown } | null;
}

function preconditionOf(
  id: number | string,
  opts: EntityWriteOptions | undefined,
): { headers: Record<string, string>; body: Record<string, unknown> } {
  if (opts?.precondition) {
    return { headers: opts.precondition.headers ?? {}, body: opts.precondition.body ?? {} };
  }
  // The blob's own version when the caller says what it merged over; the
  // registry only for a caller that cannot (the shared CollectionClient's
  // two-argument writes). Still one version, never a merge of two.
  const version = versionFromRecord(opts?.basedOn) ?? heldVersion(id);
  const parts = preconditionFor(version, PRECONDITION_SPELLING);
  return { headers: parts.headers, body: parts.body };
}

/**
 * The `ConditionalWriteClient` `useConditionalSave` asks for, over ONE record.
 *
 * ── WHY THIS IS NOT EIGHT LINES OF `fetch` ──────────────────────────────────
 *
 * The hook's own documentation shows a plain `fetch` adapter, and it would be
 * wrong here. Every write in this app has to pass through {@link wireSafeData}
 * and through the shared client's recursive camelCase -> snake_case request
 * transform: the blob a surface holds carries `sourceMeta` and `teamVerdict`,
 * which only reach the tenant as `source_meta` and `team_verdict` because the
 * client rewrites them. A `fetch` would send the camel spellings verbatim and
 * mint a parallel set of undeclared attribute keys — the exact corruption class
 * the wire-safety section above exists to stop, and one this repo has already
 * had once. So the transport stays `api.client.patch`.
 *
 * ── AND THE PRICE OF THAT, WHICH IS THE PART TO READ ───────────────────────
 *
 * The shared client THROWS on a non-2xx and normalises the body away. For a
 * plain DRF error (`{detail, …}`) `parseErrorResponse` keeps `detail` and
 * `status` and DISCARDS every other key, so `current_version` — the one value
 * the recovery depends on — never reaches the browser, and `detail` lands as a
 * property of `ApiException` rather than inside any body the shared
 * `parseStaleSaveRefusal` looks in. Handed the exception as-is it would read
 * `{status: 412}` with neither half, the dialog would open naming nobody and
 * `keepMine` would send NO precondition at all: an unguarded overwrite recorded
 * `precondition: "none"`, so the trail would claim nobody checked.
 *
 * So a 412 is REBUILT into the shape the contract specifies, and the missing
 * `current_version` is read back off the record. That is one extra request, on
 * the conflict path only, and the design already accepts two there (the 412
 * carries no identity by design, so the dialog reads `/revisions/` for the name
 * regardless — bd startsim-j4kx6 §7).
 *
 * THE RE-READ IS NOT A RETRY. Nothing here adopts the version it finds; it is
 * handed to the dialog, and only an explicit `keepMine` ever sends it. A blind
 * retry at the current version is precisely the overwrite the 412 prevented.
 */
export function entityWriteClient(id: number | string): ConditionalWriteClient {
  return {
    write: async ({ body, headers }): Promise<ConditionalWriteOutcome> => {
      // `body` is whatever the page handed `save()`, plus the hook's own
      // precondition under the chosen spelling. Split the two apart so the
      // record fields go through `updateEntity`'s re-keying and the precondition
      // goes through verbatim as the caller-owned guard.
      const { name, data, ...precondition } = body as {
        name?: string;
        data?: Record<string, unknown>;
      } & Record<string, unknown>;
      try {
        const saved = await updateEntity(
          id,
          {
            ...(name !== undefined ? { name } : {}),
            ...(data !== undefined ? { data } : {}),
          },
          { precondition: { headers, body: precondition } },
        );
        return { status: 200, body: saved };
      } catch (error) {
        if (!(error instanceof ApiException) || error.status !== STALE_SAVE_HTTP_STATUS) throw error;
        return {
          status: STALE_SAVE_HTTP_STATUS,
          body: {
            // The server's own sentence names both versions and is safe to show.
            detail: error.detail ?? error.message,
            ...(await currentVersionOf(id)),
          },
        };
      }
    },
  };
}

/** 412. Local rather than imported so this file does not depend on the shared
 *  module for one integer it compares against an `ApiException.status`. */
const STALE_SAVE_HTTP_STATUS = 412;

/**
 * `{current_version}` for the record, or `{}` when it cannot be read.
 *
 * `{}` IS A LEGITIMATE ANSWER AND MUST NOT THROW. A failure here happens while
 * the app is already reporting a conflict, and losing the conflict because the
 * follow-up read failed would put the reviewer back in the editor with no idea
 * their save did not land. The dialog is built to be useful on `detail` alone.
 *
 * IT DELIBERATELY DOES NOT GO THROUGH {@link getEntity}, so the version it finds
 * is NOT remembered. Recording it would let the registry adopt the version the
 * refusal named, and the next unparameterised write on this id — a second click
 * on a drawer's Save — would then succeed and perform exactly the overwrite the
 * 412 just prevented. The guard has to stay refused until a read the USER asked
 * for replaces the blob they are holding.
 */
async function currentVersionOf(id: number | string): Promise<{ current_version?: number }> {
  try {
    const record = await api.client.get<EntityRecord>(`api/v1/entities/${id}`);
    return typeof record?.version === 'number' ? { current_version: record.version } : {};
  } catch {
    return {};
  }
}

export function deleteEntity(id: number | string) {
  return api.client.delete(`api/v1/entities/${id}`);
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
/**
 * The shared CollectionClient over this app's writes. Its optional third
 * argument (`{ expectedVersion }`, @startsimpli/ui bd startsim-jkkn7.20) is the
 * version of the blob the shared drawer / inline actions MERGED OVER, so it maps
 * to `basedOn` — the one precondition source per request — and the registry is
 * consulted only when a caller holds no version.
 */
export const collectionClient: CollectionClient = {
  listTypes,
  listAllEntities,
  updateEntity: (id, input, options) =>
    updateEntity(
      id,
      input,
      options?.expectedVersion !== undefined ? { basedOn: { version: options.expectedVersion } } : undefined,
    ),
};

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
  /**
   * The same `scope_access` report the list envelope carries, when the backend
   * is new enough to send it here. Optional in both senses: absent on a tenant
   * that gates nothing, and absent on a deployed image that predates it — which
   * is why `fetchScopeAccess` reads the envelope instead of this.
   */
  scopeAccess?: ScopeAccess;
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
