import { createElement, type ReactNode } from 'react';
import type { ColumnConfig } from '@startsimpli/ui';
import type { AttributeDef, EntityRecord } from '@/lib/foundry-api';
import { initialsOf } from '@/lib/roster';

/** Attribute-name convention for the assignee chip (startsim-71z6) — any type
 *  that declares this attr gets the compact initials cell, not just topic/draft. */
const ASSIGNEE_NAME_ATTR = 'assignee_name';

/** Fixed widths (px) for the compact meta columns so the Title column can't eat
 *  the whole row. The Title column is the only flexible one (min/max below). */
const COL_WIDTH: Record<string, number> = {
  content_type: 120,
  status: 116,
  market: 140,
  ai_rank: 80,
  team_verdict: 132,
  [ASSIGNEE_NAME_ATTR]: 72,
  createdAt: 112,
};
const DEFAULT_ATTR_WIDTH = 140;

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
  [ASSIGNEE_NAME_ATTR]: 'Assignee',
};

/** A small rounded initials chip — the assignee column's cell, matching the
 *  board card's compact treatment (see entity-board.tsx). */
function assigneeCell(value: unknown) {
  if (value == null || value === '') return '—';
  const initials = initialsOf(String(value));
  if (!initials) return '—';
  return createElement(
    'span',
    {
      className:
        'inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-medium text-neutral-700',
      title: String(value),
    },
    initials,
  );
}

export function humanizeHeader(name: string): string {
  const known = HEADER_LABELS[name];
  if (known) return known;
  const spaced = name.replace(/_+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Attributes that are NEVER default-visible, however early they sit in the type's
 * attribute order. The reviewers asked for these three off the column view
 * ("these don't have much added value for us" — Malin + Jurga, bd startsim-b008b):
 *
 *   ai_rank      → "Ai rank"      · the AI's ordering signal, the "AI verdict"
 *   scope_path   → "Scope path"   · always "/ogmc" on this tenant — one value
 *   team_verdict → "Team verdict" · the decision, already made by the row's actions
 *
 * They stay COLUMNS — one toggle away in the Columns menu — they just stop being
 * on by default.
 *
 * team_verdict KEEPS BEING WRITTEN. It is the signal the n8n re-rank agent keys
 * off (`good` → ready, `bad` → rejected); InlineReviewActions / applyDecisionToData
 * must go on writing it. Only the column goes away.
 */
export const NEVER_DEFAULT_ATTRS: readonly string[] = ['ai_rank', 'scope_path', 'team_verdict'];

/**
 * Long body/blob attributes that are never default-visible — a table is for
 * scanning, not for reading a 500-word article. They live on the detail page and
 * stay one toggle away in the Columns menu.
 */
const LONG_FIELDS: readonly string[] = [
  'blog', 'linkedin', 'seo', 'sources', 'body', 'content', 'auto_checks', '_origin', '_sample',
];

/** The content-defining fields, shown first when the type declares them. */
const PREFERRED_ATTRS: readonly string[] = [
  'content_type', 'status', 'judge_verdict', 'candidate_index', 'story_title', 'sent_at',
  'market', 'assignee_name',
];

/** How many attribute columns a default view may open with — a WIDTH CEILING. */
const DEFAULT_ATTR_CAP = 6;

export interface DefaultVisibleOptions {
  /** Attributes folded into the title cell — the same list passed as `hide`. */
  hide?: string[];
  /** Whether the view renders the trailing inline-decision column. */
  withActions?: boolean;
  /**
   * Extra column ids to show immediately after Created — where a row came from
   * belongs beside when it arrived (the Drafts table's origin column,
   * bd startsim-4gw21). Kept out of the attribute cap: these are computed
   * columns, not declared attributes, so they cannot evict one.
   */
  afterCreated?: string[];
}

/**
 * The column ids a records table opens with, for any type. Lives here rather than
 * at the call site so every view — today's topic / draft / news tables and
 * whatever is added next — gets the same defaults for free.
 *
 * Order mirrors buildRecordColumns: Title, then Created (so "when was this made"
 * is readable without crossing the table), then the content-defining attributes.
 */
export function defaultVisibleColumns(
  attributes: AttributeDef[],
  opts: DefaultVisibleOptions = {},
): string[] {
  const excluded = new Set([...LONG_FIELDS, ...(opts.hide ?? [])]);
  const attrIds = attributes.map((a) => a.name).filter((n) => !excluded.has(n));
  const preferred = PREFERRED_ATTRS.filter((p) => attrIds.includes(p));
  const rest = attrIds.filter((a) => !preferred.includes(a));
  // Cap FIRST, then drop the no-value columns. Filtering before the cap would
  // BACKFILL the freed slots with whatever attribute came next (on `topic`:
  // team_notes, a longtext blob, and source_1, a raw URL) — re-widening the very
  // table the reviewer already can't scroll. Removing a column has to make the
  // row narrower; the cap is a width ceiling, not a quota to fill.
  const visibleAttrs = [...preferred, ...rest]
    .slice(0, DEFAULT_ATTR_CAP)
    .filter((n) => !NEVER_DEFAULT_ATTRS.includes(n));
  return [
    'name',
    'createdAt',
    ...(opts.afterCreated ?? []),
    ...visibleAttrs,
    ...(opts.withActions ? ['__actions'] : []),
  ];
}

export interface RecordColumnsOptions {
  /**
   * Render the primary column as a stacked Title + subtitle instead of a bare
   * Name — the subtitle is the first non-empty of these attrs (e.g. the split-off
   * `subtitle`, falling back to `angle`). Kills the Name/Title duplication.
   */
  subtitleAttrs?: string[];
  /** Attribute names to omit as their own columns (folded into the title cell). */
  hide?: string[];
  /** Render a trailing, fixed-width, right-aligned "Actions" column (fast triage). */
  actionsCell?: (row: EntityRecord) => ReactNode;
  /**
   * Header over the inline decision cluster. Blank by default, which is what it
   * used to always be — a row of tick/cross buttons under no heading, saying
   * nothing about WHAT it decides (bd startsim-b313v).
   */
  actionsHeader?: string;
}

/** The stacked "Title over subtitle" cell for the primary column. */
function titleSubtitleCell(row: EntityRecord, subtitleAttrs: string[]) {
  const title = String(row.name || '').trim();
  let sub = '';
  for (const a of subtitleAttrs) {
    const v = readAttrValue(row.data, a);
    if (v != null && String(v).trim()) {
      sub = String(v).trim();
      break;
    }
  }
  return createElement(
    'div',
    { className: 'min-w-0 py-0.5' },
    createElement(
      'div',
      { className: 'line-clamp-2 break-words font-medium leading-snug text-gray-900' },
      title || '—',
    ),
    sub
      ? createElement('div', { className: 'mt-0.5 line-clamp-1 break-words text-xs text-gray-500' }, sub)
      : null,
  );
}

/**
 * Build UnifiedTable columns from a type's declared attributes. Each attribute
 * becomes a column reading out of the record's `data` blob, behind a leading
 * Name + Created pair. With `opts.subtitleAttrs`, the leading column becomes a
 * stacked Title + subtitle (and `opts.hide` folds the now-redundant
 * title/subtitle/angle columns into it).
 *
 * Which of these open visible is `defaultVisibleColumns` above.
 */
export function buildRecordColumns(
  attributes: AttributeDef[],
  opts: RecordColumnsOptions = {},
): ColumnConfig<EntityRecord>[] {
  const hidden = new Set(opts.hide ?? []);
  const attrColumns: ColumnConfig<EntityRecord>[] = attributes
    .filter((attr) => !hidden.has(attr.name))
    .map((attr) => ({
    id: attr.name,
    header: humanizeHeader(attr.name),
    // Fixed, compact width so meta columns stay visible and one-line.
    width: COL_WIDTH[attr.name] ?? DEFAULT_ATTR_WIDTH,
    cell: (row) =>
      attr.name === ASSIGNEE_NAME_ATTR
        ? assigneeCell(readAttrValue(row.data, attr.name))
        : formatCell(readAttrValue(row.data, attr.name), attr),
    // Every column is sortable: the header sort needs a comparable value, and the
    // rendered `cell` is display-only. accessorFn reads the raw scalar from the
    // data blob (object/blob values sort as '' so they don't explode the compare).
    sortable: true,
    accessorFn: (row: EntityRecord) => sortValue(readAttrValue(row.data, attr.name)),
  }));

  // The Title column is the ONLY flexible one — bounded so it can't eat the row,
  // and its cell wraps (2 lines) instead of truncating.
  const nameColumn: ColumnConfig<EntityRecord> = opts.subtitleAttrs?.length
    ? {
        id: 'name',
        header: 'Title',
        accessorKey: 'name',
        sortable: true,
        minWidth: 280,
        maxWidth: 560,
        cell: (row) => titleSubtitleCell(row, opts.subtitleAttrs!),
      }
    : {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        sortable: true,
        minWidth: 240,
      };

  // Created sits IMMEDIATELY after the title, not at the far right — "when was
  // this made" is read alongside "what is it", and at the end of a wide row it
  // was off-screen (Malin, bd startsim-b008b).
  const createdColumn: ColumnConfig<EntityRecord> = {
    id: 'createdAt',
    header: 'Created',
    width: COL_WIDTH.createdAt,
    cell: (row) =>
      row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—',
    sortable: true,
    // ISO timestamps sort chronologically as plain strings.
    accessorFn: (row: EntityRecord) => row.createdAt ?? '',
  };

  const columns: ColumnConfig<EntityRecord>[] = [
    nameColumn,
    createdColumn,
    ...attrColumns,
  ];

  if (opts.actionsCell) {
    columns.push({
      id: '__actions',
      header: opts.actionsHeader ?? '',
      width: 132,
      sortable: false,
      cell: opts.actionsCell,
    });
  }

  return columns;
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
