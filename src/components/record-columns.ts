import { createElement, type ReactNode } from 'react';
import type { ColumnConfig } from '@startsimpli/ui';
import type { AttributeDef, EntityRecord } from '@/lib/foundry-api';
import { initialsOf } from '@/lib/roster';
import { humanizeChoice } from '@/lib/board';
import { CONTENT_TYPE_ATTR, contentCategoryLabel } from '@/lib/content';

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
  // "AI judge", not "Judge" (bd startsim-qrnnx, startsim-a0735): beside State,
  // a bare "Judge: reject" read as a person's decision.
  judge_verdict: 'AI judge',
  story_title: 'Title',
  // Which candidate of the writer run this draft is; "#" said nothing.
  candidate_index: 'Candidate',
  [ASSIGNEE_NAME_ATTR]: 'Assignee',
  // Read as a duplicate of Assignee, a mis-cased acronym and a URL fragment
  // (bd startsim-xjf0x).
  ai_rank: 'AI rank',
  assignee_sub: 'Assignee ID',
  scope_path: 'Scope',
};

/**
 * A field's name in a sentence or a form label — history rows, the stale-save
 * dialog, the create and edit forms. Same vocabulary as the column headers.
 */
export const attrLabel = humanizeHeader;

/**
 * System bookkeeping keys (`_run_id`, `_origin`, `_copied_from`): written by
 * the pipeline, never declared, and nothing a reader can act on. History and
 * forms leave them out (bd startsim-mpjbi).
 */
export function isSystemAttr(name: string): boolean {
  return name.startsWith('_');
}

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
 * Attributes that widen a row without helping anyone scan it, so they are never
 * default-visible. Two shapes, both measured on the live tenant 2026-09-07:
 *
 *   body/blob text — a table is for scanning, not for reading a 500-word
 *   article (`snippet` averages 313 characters and runs to 6,374)
 *
 *   long single-line values — `url` averages 106 characters and runs to 171,
 *   so its cell is as wide as a paragraph even though it is one line
 *
 * They live on the detail page and stay one toggle away in the Columns menu.
 */
const WIDE_FIELDS: readonly string[] = [
  'blog', 'linkedin', 'seo', 'sources', 'body', 'content', 'snippet', 'url',
  'auto_checks', '_origin', '_sample',
];

/**
 * Attributes that just repeat the record's own name, so a column of them says
 * nothing the leading Title column has not already said. On news_item
 * `data.title` was byte-identical to `record.name` in 146 of 150 live rows
 * (2026-09-07), and it was sitting in the default six purely because the type's
 * attribute order is DB-natural (bd startsim-8hgmq.1).
 *
 * The content spine reaches the same end differently: it FOLDS title/subtitle/
 * angle into a stacked Title cell via `hide`, so on topic there is no `title`
 * column to drop. This list is for the types that do not fold.
 *
 * `name` is the same story on scope and client: both declare a `name`
 * attribute that mirrors `record.name`, so their tables opened with two
 * columns both headed "Name" (bd startsim-m7fdm.40).
 */
/** The data attribute that copies the record name (bd startsim-pmwfj). */
export const TITLE_ATTR = 'title';

const NAME_DUPLICATE_ATTRS: readonly string[] = [TITLE_ATTR, 'name'];

/** Does this type declare the name-copy `title`? Forms then show Name alone and
 *  write it to both, so the two never disagree. */
export function hasTitleAttr(type: { attributes: Array<{ name: string }> }): boolean {
  return type.attributes.some((a) => a.name === TITLE_ATTR);
}

/**
 * Attributes that are a MACHINE JOIN KEY — an opaque id whose only reader is
 * code. A column of 36-character uuids tells a reviewer nothing, at the same
 * width as a column that would have.
 *
 * `topic_ref` IS HERE BECAUSE IT WAS DECLARED, NOT DESPITE IT (bd
 * startsim-8hgmq.11). It is the edge from a draft back to its topic, written on
 * 147 of 150 live drafts — and it was never a declared AttributeDef, so a
 * server-side filter on it was ACCEPTED, matched nothing, and answered
 * `count: 0` while naming itself in `applied_filters`. That silence emptied the
 * Drafts tab for every user and left the "already has drafts" guard structurally
 * unable to fire. Declaring it fixes both AND makes it a generated column here,
 * so the two halves ship together.
 *
 * On the draft type as it stands the exclusion changes nothing: six PREFERRED
 * attributes exactly fill DEFAULT_ATTR_CAP, so `topic_ref` sits in `rest` and
 * never reaches a slot. That guarantee is ACCIDENTAL — one attribute leaving
 * PREFERRED_ATTRS frees the slot — and this list is what makes it deliberate.
 */
const JOIN_KEY_ATTRS: readonly string[] = ['topic_ref'];

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
  /**
   * Attributes THIS view has counted as near-always-blank, so they stop
   * spending a default column (bd startsim-8hgmq.10). Applied after the cap,
   * like every other exclusion, so dropping one narrows the row.
   *
   * Per-view rather than a constant here, because emptiness is a property of a
   * type's DATA and not of an attribute's name. `assignee_name` is the proof:
   * it is blank in 152 of 153 drafts AND in 82 of 84 topics, but the reviewers
   * asked for the topic column and startsim-71z6 built its initials chip, so a
   * shared name list would take away a column somebody uses. The view that
   * measured itself is the one that gets to drop it.
   */
  sparse?: string[];
  /**
   * Attributes THIS view ALREADY renders as a filter chip row above the grid, so
   * a column of them repeats what the chips have said — at the cost of a default
   * slot on a table reviewers have twice called too wide to scroll (bd
   * startsim-m7fdm.11, startsim-5pq7h, startsim-xe1uo). Applied after the cap
   * like every other exclusion, so dropping one NARROWS the row.
   *
   * DELIBERATELY NOT `sparse`, and the distinction is the reason this is a
   * second option rather than an addition to that list. `sparse` asserts a
   * MEASUREMENT — assignee_name blank in 152 of 153 drafts, so its column
   * renders an em dash. `status` is the opposite of blank: populated on 171 of
   * 171 topics. It goes because it is REDUNDANT, not because it is empty, and
   * filing it under `sparse` would leave the next reader of that list believing
   * a count nobody took.
   *
   * Per-view for the same reason `sparse` is: whether a chip row renders is a
   * property of a VIEW, not of an attribute's name. Drafts and News declare
   * `status` too and both draw the chips, so the argument would carry there —
   * but only the Topics table was asked for, and `status` sits in the SHARED
   * PREFERRED_ATTRS, so doing this there would have taken State out of all
   * three. The view that decides its chips say enough is the one that passes it.
   */
  shownAsFilter?: string[];
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
  // `hide` is the ONLY pre-cap exclusion, and it has to be: those attributes are
  // folded into the stacked Title cell, so buildRecordColumns never emits a
  // column for them and naming one here would point at nothing.
  const hidden = new Set(opts.hide ?? []);
  const attrIds = attributes.map((a) => a.name).filter((n) => !hidden.has(n));
  const preferred = PREFERRED_ATTRS.filter((p) => attrIds.includes(p));
  const rest = attrIds.filter((a) => !preferred.includes(a));
  // Cap FIRST, then drop the no-value columns. Filtering before the cap would
  // BACKFILL the freed slots with whatever attribute came next — re-widening the
  // very table the reviewer already can't scroll. Removing a column has to make
  // the row narrower; the cap is a width ceiling, not a quota to fill.
  //
  // This is not hypothetical. Dropping news_item's Url/Title/Snippet BEFORE the
  // cap hands their three slots to source_name, tier and approved — which on 150
  // live rows were, respectively, identical to domain 150/150, null 150/150 and
  // true 150/150. Three long columns would become three worthless ones and the
  // table would still be wider than the screen (bd startsim-8hgmq.1).
  const droppedAfterCap = new Set([
    ...NEVER_DEFAULT_ATTRS,
    ...WIDE_FIELDS,
    ...NAME_DUPLICATE_ATTRS,
    ...JOIN_KEY_ATTRS,
    ...(opts.sparse ?? []),
    ...(opts.shownAsFilter ?? []),
  ]);
  // Paragraph fields go by DATA TYPE, not only by the WIDE_FIELDS name list: a
  // longtext cell is a clamped 90-character snippet nobody can scan, and four of
  // them (scope's brand_voice / priority_framework / guardrails / services)
  // pushed Active off the screen (bd startsim-dshrd).
  const longText = new Set(attributes.filter((a) => a.dataType === 'longtext').map((a) => a.name));
  const visibleAttrs = [...preferred, ...rest]
    .slice(0, DEFAULT_ATTR_CAP)
    .filter((n) => !droppedAfterCap.has(n) && !longText.has(n));
  return [
    'name',
    'createdAt',
    ...(opts.afterCreated ?? []),
    ...visibleAttrs,
    ...(opts.withActions ? ['__actions'] : []),
  ];
}

/** Ids the leading Name and Created columns already own. */
const FIXED_COLUMN_IDS = new Set(['name', 'createdAt']);

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
    // An attribute literally called `name` (scope, client) would share the
    // fixed Name column's id: both rendered, both pinned by `alwaysVisible`, and
    // React warned on the duplicate key (bd startsim-m7fdm.40). The record name
    // already fills that column, so the attribute gets none.
    .filter((attr) => !hidden.has(attr.name) && !FIXED_COLUMN_IDS.has(attr.name))
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
  // The kind reads as the sidebar names it ("Evergreen"), never as its stored key.
  if (attr.name === CONTENT_TYPE_ATTR && typeof value === 'string') return contentCategoryLabel(value);
  if (attr.dataType === 'boolean') return value ? 'Yes' : 'No';
  if (attr.dataType === 'enum' && typeof value === 'string') return humanizeChoice(value);
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
