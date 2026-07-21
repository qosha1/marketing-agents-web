import type { ColumnConfig } from '@startsimpli/ui';
import type { AttributeDef, EntityRecord } from '@/lib/foundry-api';

/**
 * Human column headers. A few known keys get a domain label (content_type →
 * "Kind", status → "State" — the vocabulary the content tables use); everything
 * else is de-snaked and sentence-cased so a raw `country_code` reads as
 * "Country code" instead of a machine name. Generic — no type is special-cased.
 */
const HEADER_LABELS: Record<string, string> = {
  content_type: 'Kind',
  status: 'State',
  judge_verdict: 'Judge',
  story_title: 'Title',
  candidate_index: '#',
};

export function humanizeHeader(name: string): string {
  const known = HEADER_LABELS[name];
  if (known) return known;
  const spaced = name.replace(/_+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Build UnifiedTable columns from a type's declared attributes. Each attribute
 * becomes a column reading out of the record's `data` blob; a leading Name
 * column and a trailing Created column frame them.
 */
export function buildRecordColumns(
  attributes: AttributeDef[],
): ColumnConfig<EntityRecord>[] {
  const attrColumns: ColumnConfig<EntityRecord>[] = attributes.map((attr) => ({
    id: attr.name,
    header: humanizeHeader(attr.name),
    cell: (row) => formatCell(readAttrValue(row.data, attr.name), attr),
    // Every column is sortable: the header sort needs a comparable value, and the
    // rendered `cell` is display-only. accessorFn reads the raw scalar from the
    // data blob (object/blob values sort as '' so they don't explode the compare).
    sortable: true,
    accessorFn: (row: EntityRecord) => sortValue(readAttrValue(row.data, attr.name)),
  }));

  return [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      sortable: true,
    },
    ...attrColumns,
    {
      id: 'createdAt',
      header: 'Created',
      cell: (row) =>
        row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—',
      sortable: true,
      // ISO timestamps sort chronologically as plain strings.
      accessorFn: (row: EntityRecord) => row.createdAt ?? '',
    },
  ];
}

/**
 * Read a declared attribute's value out of the record's `data` blob.
 *
 * The shared @startsimpli/api client camelCases ALL response keys, INCLUDING the
 * Entity `data` blob (see foundry-api.ts wire-format note). So a snake_case
 * attribute like `country_code` lands in `data` as `countryCode`, while
 * `attr.name` stays snake_case — a direct `data[attr.name]` lookup misses every
 * multi-word attribute (only single-word names like `uuid`/`slug` matched). Read
 * the camelCased key first, falling back to the raw name for odd/digit keys the
 * transform leaves alone (startsim-e8zu.3).
 */
function readAttrValue(
  data: EntityRecord['data'] | undefined,
  name: string,
): unknown {
  if (!data) return undefined;
  const camel = name.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  return data[camel] ?? data[name];
}

/**
 * A comparable scalar for sorting a column: numbers sort numerically, strings
 * case-insensitively (lower-cased), and null / objects / blobs sort as '' so a
 * json cell never crashes the comparator or reorders by a giant serialization.
 */
function sortValue(value: unknown): string | number {
  if (value == null) return '';
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return '';
  return String(value).toLowerCase();
}

/** Cap a stringified blob so one cell never explodes the row height. */
const MAX_CELL = 90;
function clamp(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_CELL ? `${flat.slice(0, MAX_CELL).trimEnd()}…` : flat;
}

function formatCell(value: unknown, attr: AttributeDef): string {
  if (value == null || value === '') return '—';
  if (attr.dataType === 'boolean') return value ? 'Yes' : 'No';
  if (attr.dataType === 'date') {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
  }
  // An object value (a json attr like `judge_verdict`, or any nested object) must
  // render as a COMPACT summary — never the whole blob, which crushes the table.
  // Prefer a telling scalar (a Content-Judge object surfaces as its `verdict`);
  // otherwise a clamped JSON string.
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of ['verdict', 'label', 'name', 'value', 'status', 'title']) {
      if (typeof obj[k] === 'string' && obj[k]) return clamp(obj[k] as string);
    }
    try {
      return clamp(JSON.stringify(value));
    } catch {
      return clamp(String(value));
    }
  }
  if (attr.dataType === 'json') {
    // A json attr that stored a plain string — clamp it too.
    return clamp(String(value));
  }
  // Everything else (text/longtext/number) is clamped to a one-line PREVIEW. A
  // table cell is never the place for a 500-word body — that's what the detail
  // page is for. Full content is one click away via the row.
  return clamp(String(value));
}
