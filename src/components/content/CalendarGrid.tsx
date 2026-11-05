'use client';

/** The month grid (bd startsim-xr4f2): Monday first, items on their day, click opens the item. */
import Link from 'next/link';

import { calendarLabel, monthGrid } from '@/lib/content-calendar';
import type { EntityRecord } from '@/lib/foundry-api';

const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarGrid({
  year,
  month,
  placed,
  todayKey,
}: {
  year: number;
  month: number;
  placed: Map<string, EntityRecord[]>;
  todayKey: string;
}) {
  const weeks = monthGrid(year, month);
  return (
    <div className="overflow-x-auto">
      <div role="grid" aria-label="Scheduled content" className="min-w-[44rem] rounded-lg border border-border">
        <div role="row" className="grid grid-cols-7 border-b border-border bg-neutral-50 text-xs font-medium text-neutral-500">
          {DOWS.map((d) => (
            <div key={d} role="columnheader" className="px-2 py-1.5">{d}</div>
          ))}
        </div>
        {weeks.map((week, i) => (
          <div key={i} role="row" className="grid grid-cols-7 border-b border-border last:border-b-0">
            {week.map((cell) => (
              <div
                key={cell.key}
                role="gridcell"
                data-day={cell.key}
                className={`min-h-24 space-y-1 border-r border-border p-1.5 last:border-r-0 ${cell.inMonth ? '' : 'bg-neutral-50 text-neutral-400'}`}
              >
                <div className={`text-xs ${cell.key === todayKey ? 'font-bold text-emerald-700' : ''}`}>{cell.day}</div>
                {(placed.get(cell.key) ?? []).map((item) => (
                  <Link
                    key={item.id}
                    href={`/content/${item.id}`}
                    className="block truncate rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100"
                  >
                    {calendarLabel(item)}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
