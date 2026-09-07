/**
 * WHAT A BOARD CARD'S BODY SAYS — the pure selection step (bd startsim-8hgmq.5).
 *
 * A kanban card sits in a lane, under a tab, on a page with a header. Everything
 * those already say, the card does not need to say again. Quinn, 2026-09-07:
 * "in board view, the columns ARE the status so why do we still show the status
 * in the card data. thats stupid." Measured the same day, the first Evergreen
 * card said its own title back to itself, said `lead_magnet` under a tab reading
 * Evergreen, and said `suggested` inside the Suggested lane.
 *
 * Three redundancies, three rules, none of them naming an attribute:
 *
 *   (a) A VALUE THAT IS THE HEADING earns no meta row, on any type. This is the
 *       card's version of what the TABLE already does with `subtitleAttrs`/`hide`
 *       (see components/record-columns.ts, bd startsim-b313v) — except the table
 *       is handed a list of names to fold and this is derived per record, so a
 *       `title` that has genuinely DRIFTED from the name survives, which is
 *       exactly when it is worth reading. The subtitle is promoted under the
 *       heading in its place: that is the line that tells a reviewer what the
 *       topic actually covers.
 *
 *   (b) THE LANE. `statusName` is excluded here — the lanes ARE the status, and a
 *       card sitting in Suggested does not need a row saying so. The card carries
 *       no status control at all any more (bd startsim-8hgmq.12): dragging is how
 *       a card moves, every declared status has a lane, so a dropdown reached
 *       nothing a drag does not. The ✕/✓/✎ cluster stays, because a decision is
 *       not a move — approve writes status AND team_verdict together.
 *
 *   (c) AN ATTRIBUTE THE ACTIVE FACET HAS PINNED to a single value. Derived from
 *       the filters the board is actually scoped by (lib/board's `AttrFilter`),
 *       never from the name `content_type` — a `deal` board scoped by `?region=`
 *       gets the same treatment for free, and the unscoped board keeps the row,
 *       where it is the only thing telling the kinds apart.
 *
 * NONE OF THIS TOUCHES WHAT A MOVE WRITES. Dragging a card and moving it by the
 * control both write status and only status, on purpose — `laneMoveData` carries
 * the reasoning and lib/__tests__/board-review.test.ts pins it. This module is
 * display-only and calls nothing that writes.
 *
 * Pure and framework-free so it is unit-tested as one function; <EntityBoard/>
 * renders what it returns.
 */
import { readData, type AttrFilter } from '@/lib/board';
import type { AttributeDef, EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/** Attribute-name convention for the assignee chip (startsim-71z6) — any type
 *  that declares this attr gets the chip, so it is never a plain meta row. */
export const ASSIGNEE_NAME_ATTR = 'assignee_name';

/**
 * The attributes a card may promote to the line under its heading, first
 * non-empty wins. A convention, in the house style of ASSIGNEE_NAME_ATTR above:
 * any type that declares one of these gets a subtitle, no type is named. Same
 * list, same order, as the table's stacked Title cell (`subtitleAttrs` at
 * app/(dashboard)/t/[typeKey]/page.tsx).
 */
export const SUBTITLE_ATTRS: readonly string[] = ['subtitle', 'angle'];

/** How many meta rows a card may show. A CEILING, not a quota — see below. */
export const MAX_META_ROWS = 3;

export interface CardMetaRow {
  /** The attribute's declared name — the React key. */
  name: string;
  /** De-snaked for reading: `content_type` → `content type`. */
  label: string;
  /** Already display-formatted (booleans as Yes/No), so the card is dumb. */
  value: string;
}

export interface CardBody {
  /** What the card's heading renders — computed here so the rules can compare against it. */
  heading: string;
  /** The line under the heading, or null when the record has nothing to say there. */
  subtitle: string | null;
  rows: CardMetaRow[];
}

export interface CardBodyOptions {
  /** The lane attribute: its value IS the column the card sits in. */
  statusName: string;
  /**
   * The enum facets the board is already scoped by — the page's applied filters
   * (`boardAttrFilters(...).applied`), verbatim. An empty list means an unscoped
   * board, where nothing is suppressed.
   */
  pinned?: readonly AttrFilter[];
  max?: number;
}

/** Whitespace- and case-insensitive: "the same title" is a human judgement, not a byte compare. */
function norm(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isEmpty(value: unknown): boolean {
  return value == null || String(value).trim() === '';
}

/**
 * The heading the card actually renders. Kept here rather than inline in the
 * card so rule (a) compares against the string the reader is looking at, not
 * against `record.name` — a record falling back to its externalId still has a
 * heading, and an attribute repeating THAT is just as redundant.
 */
export function cardHeading(record: EntityRecord): string {
  return String(record.name || record.externalId || `#${record.id}`);
}

function format(value: unknown, attr: AttributeDef): string {
  if (attr.dataType === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function cardBody(
  type: EntityTypeDef,
  record: EntityRecord,
  opts: CardBodyOptions,
): CardBody {
  const heading = cardHeading(record);
  const pinned = opts.pinned ?? [];
  const max = opts.max ?? MAX_META_ROWS;

  // The line under the heading: the first declared subtitle attribute that has
  // something to say the heading does not already say.
  let subtitle: string | null = null;
  let subtitleFrom = '';
  for (const name of SUBTITLE_ATTRS) {
    const v = readData(record.data, name);
    if (isEmpty(v) || norm(v) === norm(heading)) continue;
    subtitle = String(v).trim();
    subtitleFrom = name;
    break;
  }

  const rows = type.attributes
    .filter(
      (a) =>
        a.name !== opts.statusName && // (b) the lane the card is sitting in
        a.name !== ASSIGNEE_NAME_ATTR && // has its own chip
        a.dataType !== 'json' &&
        a.dataType !== 'longtext', // a card is not where you read a blob
    )
    // CAP FIRST, THEN DROP — record-columns.ts learned this the expensive way
    // (see the note in its `defaultVisibleColumns`): filtering before the cap
    // BACKFILLS every freed slot with whatever attribute came next, so a change
    // that removes a redundant line hands the reader `team_notes` and `source_1`
    // instead and the card gets longer. The cap is a width ceiling, not a quota
    // to fill: removing a row has to make the card shorter.
    .slice(0, max)
    .map((a) => ({ attr: a, value: readData(record.data, a.name) }))
    .filter(({ attr, value }) => {
      if (isEmpty(value)) return false;
      if (attr.name === subtitleFrom) return false; // already under the heading
      if (norm(value) === norm(heading)) return false; // (a) it IS the heading
      // (c) the active facet has already pinned this attribute to this value.
      // Compared the way lib/board's applyAttrFilter compares, so the card and
      // the filter can never disagree about whether a record matches.
      return !pinned.some((f) => f.name === attr.name && String(value) === f.value);
    })
    .map(({ attr, value }) => ({
      name: attr.name,
      label: attr.name.replace(/_/g, ' '),
      value: format(value, attr),
    }));

  return { heading, subtitle, rows };
}

