/**
 * Generic, schema-driven status-board logic (bd ogmc-9ms.1.7).
 *
 * Turns any declared entity type that has an enum attribute (preferring one named
 * "status") into kanban lanes, and buckets records into those lanes by their
 * value. Pure + framework-free so it's unit-tested in isolation; the React
 * <EntityBoard/> composes it over @startsimpli/ui's KanbanBoard. Works for ANY
 * tenant/type (topics, deals, tickets, …) — nothing OGMC-specific here.
 */
import type { AttributeDef, EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

export interface BoardColumn {
  id: string;
  label: string;
}

/** Lane for records whose status is missing, blank, or not a declared choice. */
export const UNSET_COLUMN: BoardColumn = { id: '__unset__', label: 'Unset' };

/**
 * camelCase-aware read of a value from an Entity.data blob. The @startsimpli/api
 * client camelCases response keys (incl. the data blob), so a snake_case attr
 * `team_verdict` lands as `teamVerdict`; try the camel form first, then the raw
 * key (mirrors record-columns.ts readAttrValue).
 */
export function toCamelKey(name: string): string {
  return name.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export function readData(
  data: EntityRecord['data'] | undefined,
  name: string,
): unknown {
  if (!data) return undefined;
  const bag = data as Record<string, unknown>;
  return bag[toCamelKey(name)] ?? bag[name];
}

/** The enum choices that define the board lanes (coerced to strings). */
export function choicesOf(attr: AttributeDef | null | undefined): string[] {
  const c = attr?.config?.choices;
  return Array.isArray(c) ? c.map((x) => String(x)) : [];
}

/**
 * The attribute whose enum choices define the board columns: prefer one named
 * "status", else the first enum attribute with choices. null when the type has
 * none (the caller should fall back to the table view).
 */
export function pickStatusAttr(type: EntityTypeDef | undefined | null): AttributeDef | null {
  const attrs = type?.attributes ?? [];
  const enums = attrs.filter((a) => a.dataType === 'enum' && choicesOf(a).length > 0);
  if (enums.length === 0) return null;
  return enums.find((a) => a.name === 'status') ?? enums[0];
}

/**
 * Board columns from an enum attribute's choices, plus a trailing Unset lane for
 * records with a missing/blank/unknown value. Passing null yields just the Unset
 * lane (so a board still renders for a type with no status attr).
 */
export function boardColumns(statusAttr: AttributeDef | null): BoardColumn[] {
  return [...choicesOf(statusAttr).map((c) => ({ id: c, label: c })), UNSET_COLUMN];
}

/**
 * The primary app route for a type: a status board when it has a status enum
 * (the natural "workflow" view), else its records table. Drives both the nav and
 * the home so a content type opens as a board, a config type as a table.
 */
export function typeRoute(type: EntityTypeDef): string {
  const key = encodeURIComponent(type.key);
  return pickStatusAttr(type) ? `/board/${key}` : `/t/${key}`;
}

/** True when a type should render board-first (has a status enum). */
export function isBoardType(type: EntityTypeDef): boolean {
  return pickStatusAttr(type) !== null;
}

/**
 * Bucket records into { columnId: records[] } keyed by their status value, in the
 * input order. Every column in `columns` gets a (possibly empty) array so the
 * board renders all lanes; unknown/blank values fall into UNSET_COLUMN.
 */
export function groupByStatus(
  records: EntityRecord[],
  statusAttrName: string,
  columns: BoardColumn[],
): Record<string, EntityRecord[]> {
  const known = new Set(columns.map((c) => c.id));
  const out: Record<string, EntityRecord[]> = {};
  for (const c of columns) out[c.id] = [];
  for (const r of records) {
    const raw = readData(r.data, statusAttrName);
    const val = raw == null ? '' : String(raw);
    const col = val && known.has(val) ? val : UNSET_COLUMN.id;
    (out[col] ??= []).push(r);
  }
  return out;
}

// ---- generic ?<attrName>=<value> filter over a declared enum attribute
// (ported from the shared template, startsim-uhmk) ----

export interface AttrFilter {
  name: string;
  value: string;
}

/**
 * The first declared ENUM attribute whose name is present in `params` with a
 * value that is one of its choices. Generic `?<attrName>=<value>` filtering —
 * any enum attribute, not just "status" or "content_type". Returns null when
 * nothing matches, so a list route with no (or an unknown) param behaves
 * exactly as before.
 */
export function pickAttrFilter(
  type: EntityTypeDef | undefined | null,
  params: Record<string, string | undefined | null>,
): AttrFilter | null {
  const attrs = type?.attributes ?? [];
  for (const a of attrs) {
    if (a.dataType !== 'enum') continue;
    const raw = params[a.name];
    if (raw == null || raw === '') continue;
    const value = String(raw);
    if (choicesOf(a).includes(value)) return { name: a.name, value };
  }
  return null;
}

/** Keep only the records whose declared enum attribute equals the filter value.
 *  A null filter is the identity (unchanged list). */
export function applyAttrFilter(
  records: EntityRecord[],
  filter: AttrFilter | null,
): EntityRecord[] {
  if (!filter) return records;
  return records.filter((r) => {
    const raw = readData(r.data, filter.name);
    return raw != null && String(raw) === filter.value;
  });
}

/**
 * Every declared ENUM attribute present in `params` with a valid choice value —
 * the multi-facet sibling of pickAttrFilter (startsim-uhmk). A board route can
 * be pre-filtered by more than one facet at once (e.g. content_type AND
 * status), the same way the topic table already is.
 */
export function pickAttrFilters(
  type: EntityTypeDef | undefined | null,
  params: Record<string, string | undefined | null>,
): AttrFilter[] {
  const attrs = type?.attributes ?? [];
  const out: AttrFilter[] = [];
  for (const a of attrs) {
    if (a.dataType !== 'enum') continue;
    const raw = params[a.name];
    if (raw == null || raw === '') continue;
    const value = String(raw);
    if (choicesOf(a).includes(value)) out.push({ name: a.name, value });
  }
  return out;
}

/** Keep only records matching EVERY filter (AND). An empty list is the identity. */
export function applyAttrFilters(
  records: EntityRecord[],
  filters: AttrFilter[],
): EntityRecord[] {
  if (filters.length === 0) return records;
  return filters.reduce((recs, f) => applyAttrFilter(recs, f), records);
}

// ---- generic free-text attribute filter (startsim-a2oq) ----
// A NEW, parallel path to the enum filter above, not an extension of it: a
// free-text attribute (e.g. `assignee_sub`) has no declared `choices` to
// validate a value against, so "is this a valid value" isn't a meaningful
// question — any non-empty string is accepted verbatim.

export interface AttrTextFilter {
  name: string;
  value: string;
}

/** Sentinel value meaning "this attribute is blank or absent" — pass as the
 *  filter value for an "unassigned"-style quick filter over a text attribute. */
export const BLANK = '__blank__';

/**
 * A filter over a declared NON-enum attribute, read from `params[attrName]`.
 * null when the type doesn't declare that attribute (or declares it as an
 * enum — that's pickAttrFilter's job), or the param is absent/empty.
 */
export function pickTextAttrFilter(
  type: EntityTypeDef | undefined | null,
  attrName: string,
  params: Record<string, string | undefined | null>,
): AttrTextFilter | null {
  const attrs = type?.attributes ?? [];
  const attr = attrs.find((a) => a.name === attrName);
  if (!attr || attr.dataType === 'enum') return null;
  const raw = params[attrName];
  if (raw == null || raw === '') return null;
  return { name: attrName, value: String(raw) };
}

/**
 * Keep only records whose attribute exactly matches the filter value. The
 * BLANK sentinel matches a missing OR empty-string value (the "unassigned"
 * case). A null filter is the identity.
 */
export function applyTextAttrFilter(
  records: EntityRecord[],
  filter: AttrTextFilter | null,
): EntityRecord[] {
  if (!filter) return records;
  return records.filter((r) => {
    const raw = readData(r.data, filter.name);
    const val = raw == null ? '' : String(raw);
    return filter.value === BLANK ? val === '' : val === filter.value;
  });
}

// ---- generic relationship-edge matching (startsim-ka3j) ----

/** The minimal shape of a relationship edge this module needs — structural, so
 *  it fits this fork's own RelationshipRecord without an import-time coupling. */
export interface EdgeLike {
  relType: string;
  source: EntityRecord['id'];
  target: EntityRecord['id'];
}

/**
 * Records related to `id` via a `relType` edge, in a given direction — the
 * generic edge-walk both `written_for` (draft -> topic) and `translation_of`
 * (draft -> draft) style matching reduce to, so a caller doesn't hand-roll the
 * same filter/map twice per relationship. 'incoming' (default) returns the
 * records that point AT `id` (e.g. "drafts written for this topic", or
 * "translations of this draft"); 'outgoing' returns what `id` itself points AT
 * (e.g. "the draft this translation is OF").
 */
export function relatedByEdge(
  id: EntityRecord['id'],
  relType: string,
  edges: EdgeLike[],
  records: EntityRecord[],
  direction: 'incoming' | 'outgoing' = 'incoming',
): EntityRecord[] {
  const matchIds = new Set(
    edges
      .filter((e) => e.relType === relType && (direction === 'incoming' ? e.target === id : e.source === id))
      .map((e) => (direction === 'incoming' ? e.source : e.target)),
  );
  return records.filter((r) => matchIds.has(r.id));
}

// ---- generic child-status rollup (startsim-4w76 / startsim-n7s8) ----

export interface RollupCounts {
  /** Every matched child, regardless of status (including blank/unset). */
  total: number;
  /** Count per raw status value ('' for blank/unset). */
  byStatus: Record<string, number>;
}

/**
 * Roll up a set of "child" records into per-parent counts of their status-attr
 * value — e.g. a topic's linked drafts bucketed by draft.status, so a board
 * card can show "2/3 ready" without the board knowing what a draft or a topic
 * is. `parentIdOf` supplies the (caller-specific) child->parent matching — a
 * relationship edge (relatedByEdge), a `topic_ref`-style stamped field,
 * whatever the type declares — and returns null for a child with no parent
 * match, which is then excluded entirely (no bucket, no total).
 */
export function rollupByParent(
  children: EntityRecord[],
  parentIdOf: (child: EntityRecord) => EntityRecord['id'] | null,
  statusAttrName: string,
): Map<EntityRecord['id'], RollupCounts> {
  const out = new Map<EntityRecord['id'], RollupCounts>();
  for (const c of children) {
    const parentId = parentIdOf(c);
    if (parentId == null) continue;
    const raw = readData(c.data, statusAttrName);
    const status = raw == null ? '' : String(raw);
    let bucket = out.get(parentId);
    if (!bucket) {
      bucket = { total: 0, byStatus: {} };
      out.set(parentId, bucket);
    }
    bucket.total += 1;
    bucket.byStatus[status] = (bucket.byStatus[status] ?? 0) + 1;
  }
  return out;
}
