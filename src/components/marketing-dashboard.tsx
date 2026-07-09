'use client';

/**
 * Marketing Agents dashboard — a clean, blue-accented overview of source health
 * and article collection, per docs/foundry/build-spec.md.
 *
 * Everything is DERIVED client-side from the News Item records (the data
 * contract forbids extra source-health fields on the engine). We fetch the full
 * News Item set once and roll it up with the pure functions in @/lib/dashboard,
 * so this file is just presentation + the three quick actions:
 *   1. open a source's collected items (drill-down dialog)
 *   2. filter sources by state (producing / silent)
 *   3. open a recent news item (external link)
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BaseDialog } from '@startsimpli/ui';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Newspaper,
  RadioTower,
  RefreshCw,
} from 'lucide-react';

import { listAllEntities, listTypes } from '@/lib/foundry-api';
import {
  computeMetrics,
  humanize,
  timeAgo,
  toNewsItems,
  type CountBucket,
  type NewsItem,
  type SourceHealth,
  type SourceState,
  type TrendDay,
} from '@/lib/dashboard';

// The News Item entity's declared type key. The tenant schema uses snake_case
// keys; fall back to any type that looks like the news feed so the dashboard
// still binds if the key drifts.
function pickNewsType(types: { key: string; label: string }[]) {
  return (
    types.find((t) => t.key === 'news_item') ??
    types.find((t) => t.key === 'news') ??
    types.find((t) => /news|article|item/i.test(`${t.key} ${t.label}`)) ??
    null
  );
}

export function MarketingDashboard() {
  const typesQ = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const newsType = useMemo(
    () => pickNewsType(typesQ.data?.results ?? []),
    [typesQ.data?.results],
  );

  const recordsQ = useQuery({
    queryKey: ['entities', newsType?.key ?? 'news_item', 'all'],
    queryFn: () => listAllEntities(newsType!.key),
    enabled: !!newsType,
  });

  const items = useMemo(() => toNewsItems(recordsQ.data ?? []), [recordsQ.data]);
  // Anchor every window (today / 48h / trend) to the moment the data was fetched
  // — react-query's dataUpdatedAt is a stable, pure timestamp, so the whole
  // dashboard reads as-of a single coherent clock (and it's 0 until first load,
  // which only shows while the loading guard below is still up).
  const now = recordsQ.dataUpdatedAt;
  const metrics = useMemo(() => computeMetrics(items, now), [items, now]);

  const [drillSource, setDrillSource] = useState<string | null>(null);

  if (typesQ.isLoading || (newsType && recordsQ.isLoading)) {
    return <p className="text-sm text-gray-500">Loading dashboard…</p>;
  }
  if (!newsType) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">
          No “News Item” type is defined for this app yet.
        </p>
      </div>
    );
  }

  const drillItems = drillSource
    ? items
        .filter((i) => i.sourceName === drillSource)
        .sort((a, b) => (b.collectedAt ?? 0) - (a.collectedAt ?? 0))
    : [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">
            Source health and article collection across {metrics.sources.length}{' '}
            source{metrics.sources.length === 1 ? '' : 's'}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => recordsQ.refetch()}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
        >
          <RefreshCw className={`h-4 w-4 ${recordsQ.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Producing sources"
          value={metrics.producingSources}
          hint={`of ${metrics.sources.length} total`}
          icon={RadioTower}
          tone="blue"
        />
        <StatCard
          label="Silent sources"
          value={metrics.silentSources}
          hint="no item in 48h+"
          icon={AlertTriangle}
          tone={metrics.silentSources > 0 ? 'amber' : 'slate'}
        />
        <StatCard
          label="Collected today"
          value={metrics.today}
          hint="since midnight"
          icon={CalendarDays}
          tone="blue"
        />
        <StatCard
          label="Collected this week"
          value={metrics.thisWeek}
          hint="last 7 days"
          icon={Activity}
          tone="blue"
        />
      </div>

      {/* Source Health */}
      <SourceHealthSection sources={metrics.sources} now={now} onOpen={setDrillSource} />

      {/* Article Collection */}
      <ArticleCollectionSection metrics={metrics} />

      {/* Quick action: a source's collected items */}
      <BaseDialog open={!!drillSource} onOpenChange={(o) => !o && setDrillSource(null)} size="lg">
        <SourceItemsPanel sourceName={drillSource ?? ''} items={drillItems} now={now} />
      </BaseDialog>
    </div>
  );
}

/* ------------------------------- Metrics row ------------------------------ */

const TONES = {
  blue: 'bg-primary-50 text-primary-700',
  amber: 'bg-warning-50 text-warning-600',
  slate: 'bg-gray-100 text-gray-500',
} as const;

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: typeof Activity;
  tone: keyof typeof TONES;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONES[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

/* ------------------------------ Source Health ----------------------------- */

const STATE_FILTERS: { value: 'all' | SourceState; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'producing', label: 'Producing' },
  { value: 'silent', label: 'Silent' },
];

function SourceHealthSection({
  sources,
  now,
  onOpen,
}: {
  sources: SourceHealth[];
  now: number;
  onOpen: (sourceName: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | SourceState>('all');
  const shown = filter === 'all' ? sources : sources.filter((s) => s.state === filter);

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Source health</h2>
          <p className="text-xs text-gray-500">Silent sources are flagged first.</p>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-md px-3 py-1.5 transition ${
                filter === f.value
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">No sources in this view.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shown.map((s) => (
            <li key={s.sourceName}>
              <button
                type="button"
                onClick={() => onOpen(s.sourceName)}
                className="flex w-full items-center gap-4 px-5 py-3 text-left transition hover:bg-gray-50"
              >
                <StateDot state={s.state} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{s.sourceName}</p>
                  <p className="text-xs text-gray-500">
                    Last collected {timeAgo(s.lastCollectedAt, now)}
                  </p>
                </div>
                <div className="hidden sm:block">
                  <StatePill state={s.state} />
                </div>
                <div className="w-16 text-right">
                  <p className="font-semibold tabular-nums text-gray-900">{s.count}</p>
                  <p className="text-[11px] text-gray-400">article{s.count === 1 ? '' : 's'}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-300" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StateDot({ state }: { state: SourceState }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {state === 'producing' && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-500 opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
          state === 'producing' ? 'bg-success-500' : 'bg-warning-500'
        }`}
      />
    </span>
  );
}

function StatePill({ state }: { state: SourceState }) {
  return state === 'producing' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-800">
      <CheckCircle2 className="h-3 w-3" /> Producing
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-800">
      <Clock className="h-3 w-3" /> Silent
    </span>
  );
}

/* --------------------------- Article Collection --------------------------- */

function ArticleCollectionSection({
  metrics,
}: {
  metrics: ReturnType<typeof computeMetrics>;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Article collection</h2>
        <p className="text-xs text-gray-500">14-day trend, breakdowns and the latest items.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Trend + headline numbers span two columns on wide screens. */}
        <div className="space-y-4 lg:col-span-2">
          <TrendCard trend={metrics.trend} today={metrics.today} week={metrics.thisWeek} total={metrics.total} />
          <RecentItemsCard items={metrics.recent} />
        </div>

        <div className="space-y-4">
          <BreakdownCard title="By source" icon={Newspaper} buckets={metrics.bySourceName} />
          <BreakdownCard
            title="By source type"
            icon={RadioTower}
            buckets={metrics.bySourceType}
            format={humanize}
          />
          <BreakdownCard
            title="By sync state"
            icon={RefreshCw}
            buckets={metrics.bySyncState}
            format={humanize}
            tone="sync"
          />
        </div>
      </div>
    </section>
  );
}

function TrendCard({
  trend,
  today,
  week,
  total,
}: {
  trend: TrendDay[];
  today: number;
  week: number;
  total: number;
}) {
  const max = Math.max(1, ...trend.map((d) => d.count));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold text-gray-700">Collected — last 14 days</h3>
        <div className="flex gap-5 text-sm">
          <Headline label="Today" value={today} />
          <Headline label="This week" value={week} />
          <Headline label="Total" value={total} muted />
        </div>
      </div>

      <div className="mt-5 flex h-40 items-end gap-1.5">
        {trend.map((d, i) => {
          const isToday = i === trend.length - 1;
          const heightPct = (d.count / max) * 100;
          return (
            <div key={d.key} className="group flex flex-1 flex-col items-center justify-end">
              <div className="relative flex w-full items-end justify-center" style={{ height: '100%' }}>
                <div
                  className={`w-full max-w-[22px] rounded-t transition-all ${
                    isToday ? 'bg-primary-600' : 'bg-primary-200 group-hover:bg-primary-400'
                  }`}
                  style={{ height: `${Math.max(heightPct, d.count > 0 ? 6 : 2)}%` }}
                  title={`${d.label}: ${d.count}`}
                />
              </div>
              <span className="mt-1.5 hidden text-[10px] text-gray-400 sm:block">
                {d.label.replace(/^\w+ /, '')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Headline({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="text-right">
      <p className={`text-xl font-bold tabular-nums ${muted ? 'text-gray-400' : 'text-primary-700'}`}>
        {value}
      </p>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
    </div>
  );
}

function BreakdownCard({
  title,
  icon: Icon,
  buckets,
  format = (s: string) => s,
  tone,
}: {
  title: string;
  icon: typeof Newspaper;
  buckets: CountBucket[];
  format?: (s: string) => string;
  tone?: 'sync';
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
        <Icon className="h-4 w-4 text-gray-400" /> {title}
      </h3>
      {buckets.length === 0 ? (
        <p className="text-xs text-gray-400">No data yet.</p>
      ) : (
        <ul className="space-y-2">
          {buckets.slice(0, 8).map((b) => (
            <li key={b.key}>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 truncate text-gray-600">
                  {tone === 'sync' && <SyncDot state={b.key} />}
                  {format(b.key)}
                </span>
                <span className="ml-2 shrink-0 font-semibold tabular-nums text-gray-900">{b.count}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${tone === 'sync' ? syncBar(b.key) : 'bg-primary-500'}`}
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function syncBar(state: string): string {
  if (state === 'synced') return 'bg-success-500';
  if (state === 'failed') return 'bg-error-500';
  if (state === 'pending') return 'bg-warning-500';
  return 'bg-gray-400';
}

function SyncDot({ state }: { state: string }) {
  const color =
    state === 'synced'
      ? 'bg-success-500'
      : state === 'failed'
        ? 'bg-error-500'
        : state === 'pending'
          ? 'bg-warning-500'
          : 'bg-gray-400';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

/* ------------------------------ Recent items ------------------------------ */

function RecentItemsCard({ items }: { items: NewsItem[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">Most recent items</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">No items collected yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((i) => (
            <RecentItemRow key={String(i.id)} item={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentItemRow({ item }: { item: NewsItem }) {
  const href = item.url && /^https?:\/\//.test(item.url) ? item.url : undefined;
  const inner = (
    <>
      <SyncDot state={item.syncState} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
        <p className="text-xs text-gray-500">
          {item.sourceName}
          {item.sourceType && <span className="text-gray-400"> · {humanize(item.sourceType)}</span>}
        </p>
      </div>
      {href && <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" />}
    </>
  );

  return (
    <li>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 py-2.5 transition hover:opacity-80"
        >
          {inner}
        </a>
      ) : (
        <div className="flex items-start gap-3 py-2.5">{inner}</div>
      )}
    </li>
  );
}

/* ----------------------- Quick action: source items ----------------------- */

function SourceItemsPanel({
  sourceName,
  items,
  now,
}: {
  sourceName: string;
  items: NewsItem[];
  now: number;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{sourceName}</h2>
        <p className="text-sm text-gray-500">
          {items.length} collected item{items.length === 1 ? '' : 's'}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">No items for this source.</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
          {items.map((i) => {
            const href = i.url && /^https?:\/\//.test(i.url) ? i.url : undefined;
            return (
              <li key={String(i.id)} className="flex items-start gap-3 py-3">
                <SyncDot state={i.syncState} />
                <div className="min-w-0 flex-1">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-sm font-medium text-gray-900 hover:text-primary-700"
                    >
                      <span className="truncate">{i.title}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </a>
                  ) : (
                    <p className="truncate text-sm font-medium text-gray-900">{i.title}</p>
                  )}
                  <p className="mt-0.5 text-xs text-gray-500">
                    {i.sourceType && <span>{humanize(i.sourceType)} · </span>}
                    {i.syncState && <span>{humanize(i.syncState)} · </span>}
                    collected {timeAgo(i.collectedAt, now)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
