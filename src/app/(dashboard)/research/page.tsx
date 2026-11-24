'use client';

/**
 * Research > Overview (bd startsim-bu9tr): four read-only tiles, documents in per
 * day for the last 7 days, and topics by stage. Every number is a server count.
 */
import { useQuery } from '@tanstack/react-query';

import { ResearchHead } from '@/components/research/page-head';
import { loadOverview } from '@/lib/research/overview';
import { formatWeekday } from '@/lib/research/topics';

const BAR_AREA_PX = 140;

/** `+12 vs last week`; nothing to say when both weeks are empty. */
function weekDelta(now: number, before: number): string {
  if (now === 0 && before === 0) return '';
  const d = now - before;
  return d === 0 ? 'same as last week' : `${d > 0 ? '+' : '−'}${Math.abs(d)} vs last week`;
}

export default function ResearchOverviewPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['research', 'overview'], queryFn: () => loadOverview() });

  if (isError) return <p className="text-sm text-neutral-500">Couldn’t load the overview.</p>;
  if (isLoading || !data) return <p className="text-sm text-neutral-500">Loading overview…</p>;

  const tiles = [
    {
      label: 'Sources configured',
      value: data.sourcesConfigured,
      note: data.sourcesConfigured === 0 ? 'Add some in Settings' : `${data.sourcesOn} on`,
    },
    { label: 'Documents this week', value: data.documentsThisWeek, note: weekDelta(data.documentsThisWeek, data.documentsLastWeek) },
    { label: 'Topics in progress', value: data.topicsInProgress, note: data.topicsInProgress ? `${data.stages.ready} ready to write` : '' },
    { label: 'Made into content', value: data.madeIntoContent, note: data.madeIntoContent ? 'since the start' : '' },
  ];
  const max = Math.max(1, ...data.bars.map((b) => b.count));
  const stages = [
    { label: 'Collecting', n: data.stages.collecting },
    { label: 'Ready to write', n: data.stages.ready },
    { label: 'Made into content', n: data.stages.made },
  ];

  return (
    <div className="space-y-4">
      <ResearchHead title="Overview" sub="What is happening in research." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-card px-5 py-4">
            <div className="text-sm text-neutral-500">{t.label}</div>
            <div className="text-3xl font-bold leading-9 text-neutral-900">{t.value}</div>
            <div className="min-h-4 text-xs text-neutral-500">{t.note}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-neutral-900">Documents in, per day</h2>
          <p className="mb-3 text-xs text-neutral-500">Last 7 days</p>
          <div className="flex items-end gap-4 border-b border-border" style={{ height: 190 }}>
            {data.bars.map((b) => (
              <div key={b.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-xs text-neutral-500">{b.count}</span>
                <div
                  data-testid="day-bar"
                  className="w-full max-w-14 rounded-t bg-indigo-500"
                  style={{ height: Math.max(2, Math.round((b.count / max) * BAR_AREA_PX)) }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4">
            {data.bars.map((b) => (
              <span key={b.day} className="flex-1 text-center text-xs text-neutral-500">
                {formatWeekday(b.day)}
              </span>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Topics</h2>
          {stages.map((s) => (
            <div key={s.label} className="flex justify-between border-t border-border py-2 text-sm first:border-t-0">
              <span>{s.label}</span>
              <span className="font-semibold">{s.n}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
