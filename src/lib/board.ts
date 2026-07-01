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
