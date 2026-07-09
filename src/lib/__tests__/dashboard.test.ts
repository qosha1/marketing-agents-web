import { describe, it, expect } from 'vitest';
import {
  toNewsItem,
  parseCollectedAt,
  collectedToday,
  collectedThisWeek,
  dailyTrend,
  countByField,
  deriveSourceHealth,
  computeMetrics,
  timeAgo,
  humanize,
  type NewsItem,
} from '../dashboard';
import type { EntityRecord } from '@/lib/foundry-api';

// Fixed clock: 2026-07-09 12:00 local.
const NOW = new Date(2026, 6, 9, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function item(partial: Partial<NewsItem>): NewsItem {
  return {
    id: partial.id ?? Math.random(),
    title: partial.title ?? 'A title',
    url: partial.url ?? '',
    sourceName: partial.sourceName ?? 'Reuters',
    sourceType: partial.sourceType ?? 'press_wire',
    collectedDate: partial.collectedDate ?? '',
    syncState: partial.syncState ?? 'synced',
    collectedAt: partial.collectedAt ?? null,
  };
}

describe('toNewsItem', () => {
  it('reads camelCased data keys from the wire', () => {
    const rec: EntityRecord = {
      id: 5,
      entityType: 'news_item',
      externalId: null,
      name: 'row name',
      createdAt: '2026-07-09T10:00:00Z',
      data: {
        title: 'Acme raises Series B',
        url: 'https://ex.com/a',
        sourceName: 'PR Newswire',
        sourceType: 'press_wire',
        collectedDate: '2026-07-09T09:00:00Z',
        syncState: 'synced',
      },
    };
    const ni = toNewsItem(rec);
    expect(ni.title).toBe('Acme raises Series B');
    expect(ni.sourceName).toBe('PR Newswire');
    expect(ni.sourceType).toBe('press_wire');
    expect(ni.syncState).toBe('synced');
    expect(ni.collectedAt).toBe(new Date('2026-07-09T09:00:00Z').getTime());
  });

  it('falls back to createdAt when collected_date is missing', () => {
    const rec: EntityRecord = {
      id: 6,
      entityType: 'news_item',
      externalId: null,
      name: 'x',
      createdAt: '2026-07-08T00:00:00Z',
      data: { title: 'no date' },
    };
    const ni = toNewsItem(rec);
    expect(ni.collectedAt).toBe(new Date('2026-07-08T00:00:00Z').getTime());
    expect(ni.sourceName).toBe('Unknown source');
  });
});

describe('parseCollectedAt', () => {
  it('handles blanks and garbage', () => {
    expect(parseCollectedAt('')).toBeNull();
    expect(parseCollectedAt(null)).toBeNull();
    expect(parseCollectedAt('not a date')).toBeNull();
    expect(parseCollectedAt('2026-07-01')).toBe(new Date('2026-07-01').getTime());
  });
});

describe('today / this week windows', () => {
  const items = [
    item({ id: 1, collectedAt: NOW }), // today
    item({ id: 2, collectedAt: NOW - 2 * HOUR }), // today
    item({ id: 3, collectedAt: NOW - 3 * DAY }), // this week, not today
    item({ id: 4, collectedAt: NOW - 6 * DAY - 2 * HOUR }), // this week edge
    item({ id: 5, collectedAt: NOW - 10 * DAY }), // outside week
    item({ id: 6, collectedAt: null }), // undated
  ];

  it('counts today by calendar day', () => {
    expect(collectedToday(items, NOW).map((i) => i.id)).toEqual([1, 2]);
  });

  it('counts last 7 calendar days for the week', () => {
    expect(collectedThisWeek(items, NOW).map((i) => i.id).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('dailyTrend', () => {
  it('produces 14 zero-filled oldest→newest buckets', () => {
    const t = dailyTrend([], NOW, 14);
    expect(t).toHaveLength(14);
    expect(t[0].ts).toBeLessThan(t[13].ts);
    expect(t.every((d) => d.count === 0)).toBe(true);
  });

  it('buckets items into the right day and ignores out-of-range', () => {
    const items = [
      item({ collectedAt: NOW }),
      item({ collectedAt: NOW - 30 * 60 * 1000 }),
      item({ collectedAt: NOW - 1 * DAY }),
      item({ collectedAt: NOW - 20 * DAY }), // out of 14-day range
      item({ collectedAt: null }),
    ];
    const t = dailyTrend(items, NOW, 14);
    expect(t[13].count).toBe(2); // today
    expect(t[12].count).toBe(1); // yesterday
    expect(t.reduce((s, d) => s + d.count, 0)).toBe(3);
  });
});

describe('countByField', () => {
  it('counts and sorts descending, folding blanks', () => {
    const items = [
      item({ sourceType: 'press_wire' }),
      item({ sourceType: 'press_wire' }),
      item({ sourceType: 'patent' }),
      item({ sourceType: '' }),
    ];
    const out = countByField(items, 'sourceType', 'unspecified');
    expect(out[0]).toEqual({ key: 'press_wire', count: 2 });
    expect(out.find((b) => b.key === 'unspecified')?.count).toBe(1);
  });
});

describe('deriveSourceHealth', () => {
  it('marks producing within 48h and silent beyond, silent-first', () => {
    const items = [
      item({ sourceName: 'Fresh', collectedAt: NOW - 1 * HOUR }),
      item({ sourceName: 'Fresh', collectedAt: NOW - 5 * DAY }),
      item({ sourceName: 'Stale', collectedAt: NOW - 3 * DAY }),
      item({ sourceName: 'VeryStale', collectedAt: NOW - 10 * DAY }),
    ];
    const health = deriveSourceHealth(items, NOW);
    // Silent sources come first, oldest last-collected first.
    expect(health.map((h) => h.sourceName)).toEqual(['VeryStale', 'Stale', 'Fresh']);
    const fresh = health.find((h) => h.sourceName === 'Fresh')!;
    expect(fresh.state).toBe('producing');
    expect(fresh.count).toBe(2);
    expect(fresh.lastCollectedAt).toBe(NOW - 1 * HOUR);
    expect(health.find((h) => h.sourceName === 'Stale')!.state).toBe('silent');
  });

  it('treats a never-dated source as silent', () => {
    const health = deriveSourceHealth([item({ sourceName: 'Ghost', collectedAt: null })], NOW);
    expect(health[0].state).toBe('silent');
    expect(health[0].lastCollectedAt).toBeNull();
  });
});

describe('computeMetrics', () => {
  it('rolls up totals, source counts and recent items', () => {
    const items = [
      item({ id: 1, sourceName: 'A', collectedAt: NOW }),
      item({ id: 2, sourceName: 'A', collectedAt: NOW - 3 * DAY }),
      item({ id: 3, sourceName: 'B', collectedAt: NOW - 5 * DAY }),
      item({ id: 4, sourceName: 'B', collectedAt: null }),
    ];
    const m = computeMetrics(items, NOW);
    expect(m.total).toBe(4);
    expect(m.today).toBe(1);
    expect(m.thisWeek).toBe(3);
    expect(m.producingSources).toBe(1); // A (fresh); B is silent
    expect(m.silentSources).toBe(1);
    expect(m.recent[0].id).toBe(1); // newest first
    expect(m.recent.every((i) => i.collectedAt != null)).toBe(true);
    expect(m.trend).toHaveLength(14);
  });
});

describe('helpers', () => {
  it('humanizes enum values', () => {
    expect(humanize('press_wire')).toBe('Press Wire');
    expect(humanize('sec_filing')).toBe('Sec Filing');
    expect(humanize('')).toBe('—');
  });

  it('formats time ago', () => {
    expect(timeAgo(null, NOW)).toBe('never');
    expect(timeAgo(NOW, NOW)).toBe('just now');
    expect(timeAgo(NOW - 90 * 60 * 1000, NOW)).toBe('1h ago');
    expect(timeAgo(NOW - 3 * DAY, NOW)).toBe('3d ago');
  });
});
