/**
 * The "Created by" column (bd startsim-4gw21, widened by startsim-8hgmq.6).
 *
 * A reviewer should never have to ask who wrote a row. This renders the answer
 * lib/draft-origin.ts derives as one compact pill — Scheduled / Generated /
 * AI writer / Automation / Person — with the person who pressed the button
 * beside it when the record names one, and the full reasoning (plus the writer
 * run id) in the cell's tooltip.
 *
 * THE PILL IS THE CALLER, NOT A NEW KIND. "Scheduled" and "Generated" are both
 * `kind: 'automation'` and both wear the automation colour: a draft nobody typed
 * is a draft nobody typed, and splitting the palette would suggest the two are
 * different sorts of thing when the only difference is who started the run.
 *
 * WHY IT LIVES HERE AND NOT IN record-columns.ts. That module builds columns from
 * a type's DECLARED attributes; `_origin`, `_trigger` and `owner_sub` are neither
 * declared nor per-type — the first two are undeclared keys inside the data blob,
 * the last is a column on the row itself. So this is an extra column a table opts
 * into, appended alongside the generated ones, rather than a special case
 * threaded through the generic builder. (It also means the values are NOT
 * filterable server-side — see the note in draft-origin.ts before adding one.)
 *
 * Plain `.ts` with `createElement` (no JSX), matching record-columns.ts, so the
 * column config stays importable from non-React tests.
 */
import { createElement, type ReactNode } from 'react';
import type { ColumnConfig } from '@startsimpli/ui';

import { describeRecordOrigin, originTooltip, type OriginKind } from '@/lib/draft-origin';
import type { EntityRecord } from '@/lib/foundry-api';

/** Column id. Double-underscored like `__actions` so it can never collide with a
 *  declared attribute name (which is what the generated columns are keyed by). */
export const ORIGIN_COLUMN_ID = '__origin';

const PILL_CLASS: Record<OriginKind, string> = {
  automation: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  person: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  unknown: 'border-gray-200 bg-gray-50 text-gray-500',
};

function originCell(row: EntityRecord): ReactNode {
  const origin = describeRecordOrigin(row);
  return createElement(
    'span',
    {
      className: 'inline-flex items-center gap-1 whitespace-nowrap',
      title: originTooltip(origin),
    },
    createElement(
      'span',
      {
        className: `rounded-full border px-2 py-0.5 text-[11px] font-medium ${PILL_CLASS[origin.kind]}`,
      },
      origin.label,
    ),
    // WHO PRESSED IT, rendered whole and TRUNCATED BY CSS rather than shortened
    // in code. The string is opaque by contract — n8n forwards whatever the
    // caller sent, today an email — so any "just show the name part" rule here
    // would be this app inventing a format the pipeline deliberately does not
    // have. The ellipsis says there is more; the tooltip has all of it.
    origin.triggeredBy
      ? createElement(
          'span',
          {
            className: 'inline-block max-w-[96px] truncate align-bottom text-[10px] text-gray-500',
          },
          origin.triggeredBy,
        )
      : null,
    // "Edited" is a SECOND fact, not a different origin: a machine-written draft
    // someone has since worked on is still machine-written, and collapsing the
    // two would hide exactly the row a reviewer most wants to find.
    origin.editedFields.length > 0
      ? createElement('span', { className: 'text-[10px] text-gray-500' }, 'edited')
      : null,
  );
}

/** The column, ready to append to a table's generated columns. */
export function originColumn(): ColumnConfig<EntityRecord> {
  return {
    id: ORIGIN_COLUMN_ID,
    header: 'Created by',
    // Room for the pill plus a truncated person. The cell renders one line.
    width: 160,
    cell: originCell,
    sortable: true,
    // SORTS BY KIND FIRST, then by the caller. Sorting on the label alone was
    // right while there was one automation label; with three ('AI writer',
    // 'Generated', 'Scheduled') it would scatter the machine-written rows across
    // the alphabet and put 'Person' in the middle of them — the exact grouping
    // this sort exists to give. The "edited" flag stays a tiebreak, so a row
    // somebody has touched sorts apart from an untouched one.
    accessorFn: (row: EntityRecord) => {
      const origin = describeRecordOrigin(row);
      return `${origin.kind} ${origin.label.toLowerCase()}${origin.editedFields.length > 0 ? ' edited' : ''}`;
    },
  };
}
