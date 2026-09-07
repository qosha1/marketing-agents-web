/**
 * The "Created by" column (bd startsim-4gw21).
 *
 * A reviewer should never have to ask who wrote a row. This renders the answer
 * lib/draft-origin.ts derives — AI writer / Automation / Person — as one compact
 * pill, with the full reasoning in the cell's tooltip.
 *
 * WHY IT LIVES HERE AND NOT IN record-columns.ts. That module builds columns from
 * a type's DECLARED attributes; `_origin` and `owner_sub` are neither declared nor
 * per-type — one is an undeclared key inside the data blob, the other is a column
 * on the row itself. So this is an extra column a table opts into, appended
 * alongside the generated ones, rather than a special case threaded through the
 * generic builder.
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
    width: 132,
    cell: originCell,
    sortable: true,
    // Sort groups the machine-written rows together; the "edited" flag is a
    // tiebreak so a row somebody has touched sorts apart from an untouched one.
    accessorFn: (row: EntityRecord) => {
      const origin = describeRecordOrigin(row);
      return `${origin.label.toLowerCase()}${origin.editedFields.length > 0 ? ' edited' : ''}`;
    },
  };
}
