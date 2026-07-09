/**
 * Pure, framework-free metrics for the Marketing Agents dashboard.
 *
 * Everything the dashboard shows is DERIVED client-side from the News Item
 * records (per the data contract: "Source state is derived from News Items …
 * No additional source health fields will be created or called from the
 * engine."). Keeping the math here — pure functions taking an explicit `now`
 * — makes it unit-testable in isolation; the React <MarketingDashboard/>
 * composes it over @startsimpli/ui.
 *
 * Wire-format note: the @startsimpli/api client camelCases response keys,
 * INCLUDING the Entity `data` blob, so `source_name` lands as `sourceName`.
 * We read through `readData` (camel-first, raw fallback) exactly like the rest
 * of the app.
 */
import type { EntityRecord } from '@/lib/foundry-api';
import { readData } from '@/lib/board';

/** The declared source_type enum choices, in the order the spec lists them. */
export const SOURCE_TYPES = [
  'press_wire',
  'company_blog',
  'news_aggregator',
  'sec_filing',
  'gov_registry',
  'patent',
  'trademark',
  'nfx_signal',
] as const;

/** The declared sync_state enum choices. */
export const SYNC_STATES = ['pending', 'synced', 'failed'] as const;

/** A source counts as "silent" once its newest item is older than this. */
export const SILENT_AFTER_MS = 48 * 60 * 60 * 1000; // 48h

const DAY_MS = 24 * 60 * 60 * 1000;

export type SourceState = 'producing' | 'silent';

/** Normalized News Item — the shape every metric consumes. */
export interface NewsItem {
  id: number | string;
  title: string;
  url: string;
  sourceName: string;
  sourceType: string;
  collectedDate: string;
  syncState: string;
  /** Epoch ms of collected_date, or null when missing/unparseable. */
  collectedAt: number | null;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Parse a date-ish value to epoch ms, tolerating '', null, and bad strings. */
export function parseCollectedAt(value: unknown): number | null {
  const s = str(value).trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Project a raw Entity record onto the News Item contract fields. */
export function toNewsItem(r: EntityRecord): NewsItem {
  const collectedDate = str(readData(r.data, 'collected_date'));
  return {
    id: r.id,
    title: str(readData(r.data, 'title')) || r.name || `#${r.id}`,
    url: str(readData(r.data, 'url')),
    sourceName: str(readData(r.data, 'source_name')) || 'Unknown source',
    sourceType: str(readData(r.data, 'source_type')),
    collectedDate,
    syncState: str(readData(r.data, 'sync_state')),
    // collected_date is the collection signal; fall back to the row's own
    // createdAt so an item with no explicit date still counts toward trends.
    collectedAt: parseCollectedAt(collectedDate) ?? parseCollectedAt(r.createdAt),
  };
}

export function toNewsItems(records: EntityRecord[]): NewsItem[] {
  return records.map(toNewsItem);
}

/** Local midnight for the day containing `now` (epoch ms). */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Items collected on the current calendar day. */
export function collectedToday(items: NewsItem[], now: number): NewsItem[] {
  const start = startOfDay(now);
  return items.filter((i) => i.collectedAt != null && i.collectedAt >= start);
}

/** Items collected in the current week — the last 7 calendar days incl. today. */
export function collectedThisWeek(items: NewsItem[], now: number): NewsItem[] {
  const start = startOfDay(now) - 6 * DAY_MS;
  return items.filter((i) => i.collectedAt != null && i.collectedAt >= start);
}

export interface TrendDay {
  /** Local midnight epoch ms of the bucket. */
  ts: number;
  /** ISO yyyy-mm-dd for the bucket (stable key). */
  key: string;
  /** Short label, e.g. "Jul 9". */
  label: string;
  count: number;
}

function isoDay(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Daily counts for the last `days` calendar days, oldest→newest, one bucket per
 * day (zero-filled). Default 14 for the dashboard bar chart.
 */
export function dailyTrend(items: NewsItem[], now: number, days = 14): TrendDay[] {
  const today = startOfDay(now);
  const buckets: TrendDay[] = [];
  const index = new Map<string, TrendDay>();
  for (let i = days - 1; i >= 0; i--) {
    const ts = today - i * DAY_MS;
    const key = isoDay(ts);
    const label = new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const bucket: TrendDay = { ts, key, label, count: 0 };
    buckets.push(bucket);
    index.set(key, bucket);
  }
  for (const item of items) {
    if (item.collectedAt == null) continue;
    const bucket = index.get(isoDay(item.collectedAt));
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export interface CountBucket {
  key: string;
  count: number;
}

/**
 * Count items by a field, descending by count. Blank values fold into `blankLabel`
 * so an unlabeled item is still visible rather than silently dropped.
 */
export function countByField(
  items: NewsItem[],
  field: 'sourceName' | 'sourceType' | 'syncState',
  blankLabel = 'Unknown',
): CountBucket[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item[field] || blankLabel;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export interface SourceHealth {
  sourceName: string;
  count: number;
  /** Newest collectedAt across the source's items, or null. */
  lastCollectedAt: number | null;
  state: SourceState;
}

/**
 * Derive per-source health by grouping items on source_name: article count,
 * newest collected date, and producing/silent state (silent once the newest
 * item is older than 48h, or when the source has never produced a dated item).
 * Sorted silent-first, then by staleness, so at-risk sources surface at the top.
 */
export function deriveSourceHealth(items: NewsItem[], now: number): SourceHealth[] {
  const bySource = new Map<string, { count: number; last: number | null }>();
  for (const item of items) {
    const key = item.sourceName || 'Unknown source';
    const entry = bySource.get(key) ?? { count: 0, last: null };
    entry.count += 1;
    if (item.collectedAt != null && (entry.last == null || item.collectedAt > entry.last)) {
      entry.last = item.collectedAt;
    }
    bySource.set(key, entry);
  }

  const health: SourceHealth[] = [...bySource.entries()].map(([sourceName, e]) => {
    const producing = e.last != null && now - e.last <= SILENT_AFTER_MS;
    return {
      sourceName,
      count: e.count,
      lastCollectedAt: e.last,
      state: producing ? 'producing' : 'silent',
    };
  });

  // Silent first; within a state, oldest last-collected first (most at-risk),
  // then by name for stability.
  const rank = (s: SourceHealth) => (s.state === 'silent' ? 0 : 1);
  return health.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const la = a.lastCollectedAt ?? -Infinity;
    const lb = b.lastCollectedAt ?? -Infinity;
    if (la !== lb) return la - lb;
    return a.sourceName.localeCompare(b.sourceName);
  });
}

export interface DashboardMetrics {
  total: number;
  today: number;
  thisWeek: number;
  producingSources: number;
  silentSources: number;
  trend: TrendDay[];
  bySourceName: CountBucket[];
  bySourceType: CountBucket[];
  bySyncState: CountBucket[];
  sources: SourceHealth[];
  /** Most recent items first, capped by `recentLimit`. */
  recent: NewsItem[];
}

/** One-shot rollup of everything the dashboard renders. */
export function computeMetrics(
  items: NewsItem[],
  now: number,
  recentLimit = 8,
): DashboardMetrics {
  const sources = deriveSourceHealth(items, now);
  const recent = [...items]
    .filter((i) => i.collectedAt != null)
    .sort((a, b) => (b.collectedAt ?? 0) - (a.collectedAt ?? 0))
    .slice(0, recentLimit);
  return {
    total: items.length,
    today: collectedToday(items, now).length,
    thisWeek: collectedThisWeek(items, now).length,
    producingSources: sources.filter((s) => s.state === 'producing').length,
    silentSources: sources.filter((s) => s.state === 'silent').length,
    trend: dailyTrend(items, now),
    bySourceName: countByField(items, 'sourceName'),
    bySourceType: countByField(items, 'sourceType', 'unspecified'),
    bySyncState: countByField(items, 'syncState', 'unknown'),
    sources,
    recent,
  };
}

/** Human label for a source_type/sync_state enum value (snake_case → Title). */
export function humanize(value: string): string {
  if (!value) return '—';
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Relative "time ago" for a last-collected timestamp. */
export function timeAgo(ts: number | null, now: number): string {
  if (ts == null) return 'never';
  const diff = Math.max(0, now - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
