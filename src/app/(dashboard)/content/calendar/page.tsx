'use client';

/**
 * Content calendar (bd startsim-xr4f2): scheduled items by day. Click opens the
 * item. Scheduling itself happens on the item page. Reminders by email are the
 * follow-up in bd startsim-xwtv0.1; this page is not a posting integration.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { CalendarGrid } from '@/components/content/CalendarGrid';
import { calendarFilters, calendarLabel, monthLabel, placeItems, postedFilters, shiftMonth } from '@/lib/content-calendar';
import { fetchMonth, fetchPosted } from '@/lib/content-queries';
import { getActiveProjectId } from '@/lib/project-scope';

const keyOfToday = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function ContentCalendarPage() {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const projectId = getActiveProjectId();
  const filters = calendarFilters(ym.year, ym.month, projectId);

  const q = useQuery({
    queryKey: ['content-calendar', projectId, ym.year, ym.month],
    queryFn: () => fetchMonth(filters),
  });
  const posted = useQuery({
    queryKey: ['content-calendar', 'posted', projectId, ym.year, ym.month],
    queryFn: () => fetchPosted(postedFilters(ym.year, ym.month)),
  });
  const placed = useMemo(() => placeItems([...(q.data ?? []), ...(posted.data ?? [])]), [q.data, posted.data]);
  const empty = q.isSuccess && posted.isSuccess && (q.data ?? []).length + (posted.data ?? []).length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
        <Link href="/content" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-neutral-50">List</Link>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous month" className="rounded p-1 hover:bg-neutral-100"
          onClick={() => setYm(shiftMonth(ym.year, ym.month, -1))}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-sm font-semibold text-gray-900">{monthLabel(ym.year, ym.month)}</h2>
        <button type="button" aria-label="Next month" className="rounded p-1 hover:bg-neutral-100"
          onClick={() => setYm(shiftMonth(ym.year, ym.month, 1))}>
          <ChevronRight className="h-5 w-5" />
        </button>
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-neutral-50"
          onClick={() => setYm({ year: now.getFullYear(), month: now.getMonth() })}>
          Today
        </button>
      </div>
      {q.isError ? (
        <p className="text-sm text-neutral-500">Scheduling is not set up for this project yet, so scheduled items cannot be shown.</p>
      ) : null}
      <CalendarGrid year={ym.year} month={ym.month} placed={placed} todayKey={keyOfToday()} />
      {empty ? (
        <p className="text-sm text-neutral-500">Nothing scheduled this month.</p>
      ) : null}
    </div>
  );
}
