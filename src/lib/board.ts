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

// ---- generic recency window (bd startsim-wn2p.24) ----
// WHY: a board loads its type's WHOLE history. news_item holds 4,116 records
// (2026-07-07 onward, 2,573 of them rejected), so /board/news_item renders every
// article ever ingested into lanes nobody is working. The user's words: "we dont
// need all things in history on the board it should just be relatively recent
// ones." So the board gets a window, defaulted to recent, with an explicit All.
//
// Generic, like every other helper here: nothing knows what a news_item is. A
// type with no usable date simply falls back to the record's own createdAt.

/** URL param carrying the window, e.g. `?since=30` or `?since=all`. */
export const RECENCY_PARAM = 'since';

/** The param value meaning "no window" — every record, as before. */
export const RECENCY_ALL = 'all';

export interface RecencyWindow {
  /** Days back from `now`. `null` means all time. */
  days: number | null;
}

/** The windows the control offers, narrowest first, All last. */
export const RECENCY_WINDOWS: { days: number | null; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: null, label: 'All' },
];

/**
 * The window a board opens in WHEN IT OPENS ON ONE. 14 days, measured: it is the
 * widest offered window that still cuts the live news board by roughly two
 * thirds (4,116 -> 1,135 by published_at).
 */
export const DEFAULT_RECENCY_DAYS = 14;

/**
 * Whether a type's board should open windowed at all — and the reason a blanket
 * default was NOT shipped.
 *
 * MEASURED against the live tenant before choosing this rule: a 14-day default
 * applied to every board would have hidden 57 of 77 drafts, 26 of 59 topics and
 * the single `client` record. Those boards have no clutter problem; news_item,
 * at 4,116 records, is the entire complaint. A count threshold would need the
 * count before the fetch and would make the default flicker, so the rule is the
 * SCHEMA: a type that records when things HAPPENED (a declared recency
 * attribute, which is also the only thing the backend can narrow on) opens on a
 * window; a type that does not opens on everything, exactly as before.
 *
 * The control is still offered on every board — narrowing a small board is a
 * choice a person can make, just not one made for them.
 */
export function defaultRecencyDays(attrName: string | null): number | null {
  return attrName ? DEFAULT_RECENCY_DAYS : null;
}

/**
 * Declared date attributes that mean "when this happened", in preference order.
 *
 * A NAME convention, not "the first date attribute", and that distinction is the
 * whole point: `draft` declares `sent_at` — a real date attribute that 1 of 77
 * live drafts carries — so measuring by "first date attribute" would push 76
 * drafts outside every window. A type whose dates are none of these measures by
 * `createdAt` instead, which every record has.
 */
const RECENCY_ATTR_NAMES = ['published_at', 'occurred_at', 'happened_at'];

/** The type's recency attribute name, or null to measure by `createdAt`. */
export function pickRecencyAttr(type: EntityTypeDef | undefined | null): string | null {
  const attrs = type?.attributes ?? [];
  for (const name of RECENCY_ATTR_NAMES) {
    if (attrs.some((a) => a.name === name && a.dataType === 'date')) return name;
  }
  return null;
}

/**
 * The date a record is measured by: its declared recency attribute, falling back
 * per-record to `createdAt` when that attribute is blank or absent.
 *
 * The fallback is deliberate, not defensive — 167 of the 4,116 live news_items
 * have no `published_at`, and dropping them would hide rows the window was never
 * asked to hide. `null` (neither date parses) is likewise NOT a reason to drop:
 * {@link applyRecencyWindow} keeps those records.
 */
export function recencyDate(record: EntityRecord, attrName: string | null): Date | null {
  const candidates: unknown[] = [];
  if (attrName) candidates.push(readData(record.data, attrName));
  candidates.push(record.createdAt);
  for (const raw of candidates) {
    if (raw == null || String(raw).trim() === '') continue;
    const d = new Date(String(raw));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * The window from the URL, falling back to `defaultDays` (see
 * {@link defaultRecencyDays}). An unrecognised value falls back to that default
 * rather than to All — a typo in a link should not silently reinstate the
 * 4,116-card board.
 */
export function pickRecencyWindow(
  params: Record<string, string | undefined | null>,
  defaultDays: number | null = DEFAULT_RECENCY_DAYS,
): RecencyWindow {
  const raw = params[RECENCY_PARAM];
  if (raw != null && String(raw) !== '') {
    const value = String(raw);
    if (value === RECENCY_ALL) return { days: null };
    const days = Number(value);
    if (RECENCY_WINDOWS.some((w) => w.days === days)) return { days };
  }
  return { days: defaultDays };
}

/**
 * The instant a window opens: UTC midnight `days` days before `now`.
 *
 * WHOLE DAYS, not `now - days * 24h`, because the attribute being measured is
 * usually date-TYPED: `published_at` arrives as `2026-08-17` and parses to
 * midnight. Against a rolling 24h cutoff, a piece published on the boundary day
 * is in or out depending on what time of day the page is opened — the same board
 * showing a different record count at 09:00 and at 15:00. Comparing whole days
 * makes the boundary stable, and makes "7 days" mean seven dates.
 */
export function recencyCutoff(days: number, now: Date): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - days * 24 * 60 * 60 * 1000);
}

/**
 * Keep only records dated within the window. `{ days: null }` is the identity,
 * and so is a record whose date cannot be read at all — an unparseable date is
 * an unknown, and hiding unknowns is how a filter loses work silently.
 * A future date is inside every window.
 */
export function applyRecencyWindow(
  records: EntityRecord[],
  window: RecencyWindow,
  attrName: string | null,
  now: Date = new Date(),
): EntityRecord[] {
  if (window.days == null) return records;
  const cutoff = recencyCutoff(window.days, now).getTime();
  return records.filter((r) => {
    const d = recencyDate(r, attrName);
    return d == null || d.getTime() >= cutoff;
  });
}

/**
 * The SERVER-SIDE half of the window: the tenant backend's own filter for
 * "dated on or after the cutoff", or `{}` when there is nothing to narrow.
 *
 * This is what stops the board fetching a whole type. Narrowing here means
 * `listAllEntities` walks the window instead of walking 20 pages and truncating
 * at 1,000 — see its docstring for the measurement.
 *
 * `{}` for ALL (no window) and for a type with no declared recency attribute:
 * the backend has no filter on `created_at`, so that case is narrowed by
 * {@link applyRecencyWindow} on the client instead. The two agree on the cutoff
 * because both take it from {@link recencyCutoff}.
 *
 * ONE ASYMMETRY, deliberate and worth knowing: a record whose declared date is
 * BLANK survives the client-side pass (it falls back to `createdAt`) but not
 * this one — a `>=` comparison against an empty value is false. 167 of the
 * 4,116 live news_items are in that state, and they are reachable under All.
 */
export function recencyFilters(
  attrName: string | null,
  window: RecencyWindow,
  now: Date = new Date(),
): Record<string, string> {
  if (window.days == null || !attrName) return {};
  return { [`attr.${attrName}__gte`]: recencyCutoff(window.days, now).toISOString().slice(0, 10) };
}

/**
 * The board's OTHER facets, expressed as backend filters — so a COUNT of "what
 * this type holds" is a count of the same slice the board is showing.
 *
 * Without this, `/board/news_item?status=surfaced` shows 31 records and reports
 * "4,085 older not shown", which is false twice over: those 4,085 are mostly not
 * older, and they are not this facet's records. A line whose whole job is to be
 * honest about what is hidden cannot be the one lying.
 *
 * Returns null — meaning "do not claim a number" — for the {@link BLANK}
 * sentinel, which asks for records where an attribute is ABSENT. The backend's
 * `__isnull` answers "is there an Attribute row", not "is the value empty", and
 * those differ: all 4,116 live news_items have a `published_at` row and 167 of
 * them are blank. Rather than report a count that quietly means something else,
 * report none.
 */
export function facetFilters(
  filters: AttrFilter[],
  textFilter: AttrTextFilter | null,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const f of filters) out[`attr.${f.name}`] = f.value;
  if (textFilter) {
    if (textFilter.value === BLANK) return null;
    out[`attr.${textFilter.name}`] = textFilter.value;
  }
  return out;
}

// ---- default table order for a status-carrying spine (bd startsim-azyag) ----
// MOVED here verbatim from app/(dashboard)/t/[typeKey]/page.tsx: it was a pure
// comparator trapped inside a client component, so nothing could test it. The
// behaviour is unchanged by the move — the pin logic below is what changes it.

const STATUS_RANK: Record<string, number> = { suggested: 0, ready: 1, written: 2, rejected: 3 };

/**
 * Default topic order: by pipeline stage, newest first WITHIN a stage — so new
 * topics sit on top and rejected (and written) sink to the bottom, out of the way.
 */
export function defaultTopicOrder(a: EntityRecord, b: EntityRecord): number {
  const ra = STATUS_RANK[String(readData(a.data, 'status') ?? '')] ?? 0;
  const rb = STATUS_RANK[String(readData(b.data, 'status') ?? '')] ?? 0;
  if (ra !== rb) return ra - rb;
  return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
}

// ---- "where did the thing I just did go?" (bd startsim-azyag) ----
//
// THE DEFECT, in the customer's words: "you go in, you approve the topic, and
// then what you approved ends up down at the list, where you have to scroll to
// find a checkmark." Approving a topic moves it `suggested` -> `ready`, and
// BOTH of this module's list rules then act on the new value:
//
//   1. `defaultTopicOrder` ranks by status, so the row travels below every
//      remaining suggested one — off-page on a 59-topic table;
//   2. an active State=suggested facet stops matching it, so the row leaves
//      the list altogether.
//
// A DebuggAI browser agent hit the same wall independently, spending its entire
// 20-step budget hunting the row it had just acted on.
//
// THE FIX IS NOT A NEW PLACE TO LOOK. Quinn ruled that out on the call —
// "moving it into different places makes it harder for people to find it
// later." So the list REMEMBERS the rows this session acted on and holds each
// one where it was: the reviewer's own action never moves anything under them.
// Memory is per-session and deliberately not persisted — it answers "what did I
// just do", not "what happened last week", and the facets answer the latter.

/** A row the user has just acted on, and where it sat when they did. */
export interface ActedRow {
  id: EntityRecord['id'];
  /** Position the row held in the visible list at the moment of the action. */
  index: number;
  /**
   * What was decided.
   *
   * TODAY THIS IS ALWAYS 'decided' (bd startsim-b313v.1 tracks the rest). The
   * shared `onSaved` callbacks report no arguments, so the fork cannot tell an
   * approve from a reject without re-reading the row — and the PIN, not the
   * word, is the fix this lane owes. The field is kept because the marker will
   * want it as soon as the decision is knowable.
   */
  decision: string;
}

/**
 * Record an action, keeping the position from the FIRST time this row was
 * touched. Re-deciding must not move the row: a reviewer who approves and then
 * changes their mind to reject is looking at the same place on the page, and
 * re-pinning to the row's post-approval index would move it out from under them
 * on the second click — the exact defect, reintroduced one action later.
 */
export function noteActed(acted: ActedRow[], row: ActedRow): ActedRow[] {
  const prior = acted.find((a) => a.id === row.id);
  const next = prior ? { ...row, index: prior.index } : row;
  return [next, ...acted.filter((a) => a.id !== row.id)];
}

/** The remembered action for a record, or undefined. */
export function actedOn(acted: ActedRow[], id: EntityRecord['id']): ActedRow | undefined {
  return acted.find((a) => a.id === id);
}

/**
 * Records the active facet dropped, put back because the user just acted on
 * them. Without this, approving a topic while State=suggested is filtered makes
 * the row VANISH — the strongest form of "where did it go", and the one that
 * reads as data loss rather than as a filter working.
 *
 * Re-admitted rows are appended; {@link holdActedPositions} then puts them back
 * at their remembered index, so this never changes the visible order by itself.
 */
export function readmitActed(
  all: EntityRecord[],
  kept: EntityRecord[],
  acted: ActedRow[],
): EntityRecord[] {
  if (acted.length === 0) return kept;
  const keptIds = new Set(kept.map((r) => r.id));
  const extra = all.filter((r) => !keptIds.has(r.id) && actedOn(acted, r.id));
  return extra.length === 0 ? kept : [...kept, ...extra];
}

/**
 * Order by `compare`, then put every just-acted row back at the index it held
 * when it was acted on. An empty memory is exactly `[...records].sort(compare)`,
 * so a list nobody has touched behaves precisely as before.
 *
 * Pins are placed lowest-index first and clamped to the list length, so two
 * pinned rows cannot claim the same slot and a pin from a longer list (the user
 * cleared a filter since acting) lands at the end rather than out of bounds.
 */
export function holdActedPositions(
  records: EntityRecord[],
  acted: ActedRow[],
  compare: (a: EntityRecord, b: EntityRecord) => number,
): EntityRecord[] {
  if (acted.length === 0) return [...records].sort(compare);
  const pinned: { record: EntityRecord; index: number }[] = [];
  const rest: EntityRecord[] = [];
  for (const r of records) {
    const hit = actedOn(acted, r.id);
    if (hit) pinned.push({ record: r, index: hit.index });
    else rest.push(r);
  }
  if (pinned.length === 0) return [...records].sort(compare);
  const out = rest.sort(compare);
  for (const p of pinned.sort((a, b) => a.index - b.index)) {
    out.splice(Math.min(Math.max(p.index, 0), out.length), 0, p.record);
  }
  return out;
}

// ---- server-side narrowing for a record table (bd startsim-f4lac) ----
// Rule 8: the tenant holds thousands of records, and filtering a page you have
// already fetched is a search that silently only searches what you can see.
// Both helpers emit the `attr.<name>__<op>` shape `EntityFilters` documents and
// `entity-filters.test.ts` guards on the wire.

/**
 * Substring search over a declared text attribute.
 *
 * VERIFIED against the deployed tenant: `?type=topic&attr.title__icontains=qatar`
 * -> count 4, `applied ['attr.title__icontains','type']`. A blank box is `{}`,
 * never `attr.title__icontains=` — the backend reports an empty term as ignored,
 * and "0 results" would then look like a working search over an empty corpus.
 */
export function searchFilters(term: string, attrName: string | null): Record<string, string> {
  const t = term.trim();
  if (!t) return {};
  // No declared title attribute -> the backend's full-text `?search=`, which
  // covers the entity's `name` column. That is where a draft's title actually
  // lives: `draft` declares fourteen attributes and not one is titley, so the
  // attribute path has nothing to aim at and `attr.null__icontains` is what a
  // naive interpolation would send — a key the backend now refuses with a 400.
  // VERIFIED live 2026-08-27: ?type=draft&search=qatar -> count 19 of 99,
  // applied ['search','type'].
  //
  // The declared attribute stays PREFERRED where one exists: on `topic`,
  // attr.title__icontains searches the title, while ?search= sweeps every
  // indexed field and would match a topic whose ANGLE mentions the term. Narrower
  // is better when we can be narrow.
  return attrName ? { [`attr.${attrName}__icontains`]: t } : { search: t };
}

/**
 * Declared title-ish attributes, in preference order — WHICH attribute a title
 * search actually searches.
 *
 * A NAME convention, and the distinction matters: `title` is the TOPIC spine's
 * attribute, and `draft` does not declare it. A draft's title is `name` first
 * and `data.story_title` second (see lib/title-durability.ts), so gating the
 * search box on a declared `title` puts it on Topics and leaves it off Drafts —
 * the one surface startsim-f4lac actually names.
 *
 * ONE LIMIT, worth stating: only DECLARED attributes are filterable server-side,
 * and `name` is a column on core_entity, not an attribute. So a draft whose
 * `story_title` is blank (the case `candidateTitle` covers by falling back to
 * `name`) is not reachable by this search. Returning null — no box at all — is
 * the honest answer for a type with no titley attribute; an empty search box
 * that can never match is worse than none.
 */
const TITLE_ATTR_NAMES = ['title', 'story_title', 'headline'];

/** The attribute a title search should target, or null to offer no search box. */
export function pickTitleAttr(type: EntityTypeDef | undefined | null): string | null {
  const attrs = type?.attributes ?? [];
  for (const name of TITLE_ATTR_NAMES) {
    if (attrs.some((a) => a.name === name)) return name;
  }
  return null;
}

/**
 * Backend cap on a comma list — `MAX_ID_LIST` in tenant-starter
 * `apps/api/filters.py`, which refuses a longer one with a 400 ("at most 200
 * values") rather than truncating it.
 */
export const MAX_IN_VALUES = 200;

/**
 * `attr.<name>__in=a,b,c` — comma-separated, as `_coerce` splits it.
 *
 * `null` means "the server cannot narrow this", for an empty list or one past
 * the cap. A caller MUST treat null as "narrow on the client and say so", never
 * as "no filter": dropping a narrowing filter silently is how a cleanup loop was
 * handed page 1 of the corpus and deleted nine production rows.
 */
export function inFilters(attrName: string, values: string[]): Record<string, string> | null {
  if (values.length === 0 || values.length > MAX_IN_VALUES) return null;
  return { [`attr.${attrName}__in`]: values.join(',') };
}
