/**
 * The board's recency window (bd startsim-wn2p.24).
 *
 * MEASURED, and why this exists: /board/news_item renders 4,116 records — every
 * news_item ever ingested, 2026-07-07 onward, with 2,573 of them in the rejected
 * lane. The user's words: "we dont need all things in history on the board it
 * should just be relatively recent ones."
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RECENCY_DAYS,
  defaultRecencyDays,
  RECENCY_ALL,
  RECENCY_PARAM,
  RECENCY_WINDOWS,
  applyRecencyWindow,
  pickRecencyAttr,
  pickRecencyWindow,
  recencyDate,
  recencyFilters,
} from '../board';
import type { AttributeDef, EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const NOW = new Date('2026-08-24T12:00:00Z');

const publishedAttr: AttributeDef = {
  id: 'p', name: 'published_at', dataType: 'date', required: false, config: {},
};
const sentAttr: AttributeDef = {
  id: 's', name: 'sent_at', dataType: 'date', required: false, config: {},
};
const titleAttr: AttributeDef = {
  id: 't', name: 'title', dataType: 'text', required: false, config: {},
};

const newsType: EntityTypeDef = {
  id: 'n', key: 'news_item', label: 'News Item', attributes: [titleAttr, publishedAttr],
};
/** A type whose only date attribute is NOT a recency convention name. */
const draftType: EntityTypeDef = {
  id: 'd', key: 'draft', label: 'Draft', attributes: [titleAttr, sentAttr],
};

function rec(id: number, createdAt: string, data: Record<string, unknown> = {}): EntityRecord {
  return { id, entityType: 'news_item', externalId: null, name: 'r' + id, data, createdAt };
}

describe('pickRecencyAttr', () => {
  it('prefers a declared date attribute named by the convention', () => {
    expect(pickRecencyAttr(newsType)).toBe('published_at');
  });

  it('is null for a type whose date attributes are not convention names', () => {
    // `sent_at` is a date, but it means "when we mailed it", not "when this
    // happened" — 1 of 77 live drafts has one. Measuring recency by it would
    // put 76 drafts outside every window.
    expect(pickRecencyAttr(draftType)).toBeNull();
  });

  it('is null for a missing type', () => {
    expect(pickRecencyAttr(null)).toBeNull();
    expect(pickRecencyAttr(undefined)).toBeNull();
  });
});

describe('recencyDate', () => {
  it('reads the declared attribute when the record carries one', () => {
    const r = rec(1, '2026-08-20T00:00:00Z', { publishedAt: '2026-08-10' });
    expect(recencyDate(r, 'published_at')?.toISOString().slice(0, 10)).toBe('2026-08-10');
  });

  it('falls back to createdAt when the attribute is blank — never drops the record', () => {
    // 167 of 4,116 live news_items have no published_at. Excluding them would
    // hide rows the window was never asked to hide.
    const r = rec(2, '2026-08-20T00:00:00Z', { publishedAt: '' });
    expect(recencyDate(r, 'published_at')?.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('falls back to createdAt when there is no attribute at all', () => {
    const r = rec(3, '2026-08-20T00:00:00Z');
    expect(recencyDate(r, null)?.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('is null when neither date parses, so the record is never silently binned', () => {
    expect(recencyDate(rec(4, 'not-a-date'), null)).toBeNull();
  });
});

describe('defaultRecencyDays', () => {
  it('windows a type that records when things happened', () => {
    expect(defaultRecencyDays('published_at')).toBe(DEFAULT_RECENCY_DAYS);
  });

  it('does NOT window a type that does not — measured, not preference', () => {
    // A blanket 14-day default would have hidden 57 of 77 live drafts, 26 of 59
    // topics, and the only `client` record. Those boards are not the complaint.
    expect(defaultRecencyDays(null)).toBeNull();
  });
});

describe('pickRecencyWindow', () => {
  it('defaults to the recent window when the param is absent', () => {
    expect(pickRecencyWindow({})).toEqual({ days: DEFAULT_RECENCY_DAYS });
  });

  it('honours a caller-supplied default of "no window"', () => {
    expect(pickRecencyWindow({}, defaultRecencyDays(null))).toEqual({ days: null });
  });

  it('an explicit window still wins on a board that defaults to All', () => {
    expect(pickRecencyWindow({ [RECENCY_PARAM]: '30' }, null)).toEqual({ days: 30 });
  });

  it('honours an explicit window from the URL', () => {
    expect(pickRecencyWindow({ [RECENCY_PARAM]: '30' })).toEqual({ days: 30 });
  });

  it('honours an explicit ALL — the escape hatch back to every record', () => {
    expect(pickRecencyWindow({ [RECENCY_PARAM]: RECENCY_ALL })).toEqual({ days: null });
  });

  it('ignores a value that is not one of the offered windows', () => {
    expect(pickRecencyWindow({ [RECENCY_PARAM]: '999' })).toEqual({ days: DEFAULT_RECENCY_DAYS });
    expect(pickRecencyWindow({ [RECENCY_PARAM]: 'yesterday' })).toEqual({ days: DEFAULT_RECENCY_DAYS });
  });

  it('offers ALL among its choices, so "show me everything" stays reachable', () => {
    expect(RECENCY_WINDOWS.some((w) => w.days === null)).toBe(true);
    expect(RECENCY_WINDOWS.some((w) => w.days === DEFAULT_RECENCY_DAYS)).toBe(true);
  });
});

describe('applyRecencyWindow', () => {
  const records = [
    rec(1, '2026-08-23T00:00:00Z', { publishedAt: '2026-08-23' }), // 1d
    rec(2, '2026-08-18T00:00:00Z', { publishedAt: '2026-08-18' }), // 6d
    rec(3, '2026-08-04T00:00:00Z', { publishedAt: '2026-08-04' }), // 20d
    rec(4, '2026-07-08T00:00:00Z', { publishedAt: '2026-07-08' }), // 47d
    rec(5, '2026-07-09T00:00:00Z', { publishedAt: '2022-06-27' }), // ingested recently, published 2022
  ];

  it('keeps only records inside the window', () => {
    const kept = applyRecencyWindow(records, { days: 7 }, 'published_at', NOW);
    expect(kept.map((r) => r.id)).toEqual([1, 2]);
  });

  it('a wider window is a superset of a narrower one', () => {
    const narrow = applyRecencyWindow(records, { days: 7 }, 'published_at', NOW).map((r) => r.id);
    const wide = applyRecencyWindow(records, { days: 30 }, 'published_at', NOW).map((r) => r.id);
    expect(wide).toEqual(expect.arrayContaining(narrow));
    expect(wide).toEqual([1, 2, 3]);
  });

  it('ALL is the identity — every record, in input order', () => {
    expect(applyRecencyWindow(records, { days: null }, 'published_at', NOW)).toEqual(records);
  });

  it('measures by the declared attribute, not by ingestion time', () => {
    // Record 5 was CREATED 46 days ago but PUBLISHED in 2022. Measured by
    // published_at it is outside every offered window; that is the point.
    const kept = applyRecencyWindow(records, { days: 90 }, 'published_at', NOW);
    expect(kept.map((r) => r.id)).not.toContain(5);
  });

  it('measures by createdAt when the type declares no recency attribute', () => {
    const kept = applyRecencyWindow(records, { days: 60 }, null, NOW);
    expect(kept.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps a record whose date will not parse rather than hiding it', () => {
    const undated = rec(6, 'not-a-date');
    const kept = applyRecencyWindow([...records, undated], { days: 7 }, 'published_at', NOW);
    expect(kept.map((r) => r.id)).toContain(6);
  });

  it('a future date is inside every window', () => {
    const ahead = rec(7, '2026-09-01T00:00:00Z', { publishedAt: '2026-09-01' });
    expect(applyRecencyWindow([ahead], { days: 7 }, 'published_at', NOW).map((r) => r.id)).toEqual([7]);
  });

  it('the boundary day is inside the window, not outside it', () => {
    const exactly7 = rec(8, '2026-08-17T12:00:00Z', { publishedAt: '2026-08-17' });
    expect(applyRecencyWindow([exactly7], { days: 7 }, 'published_at', NOW).map((r) => r.id)).toEqual([8]);
  });
});


describe('recencyFilters — the SERVER-SIDE half', () => {
  // Measured live 2026-08-24: attr.published_at__gte=2026-08-10 returns 1,135 of
  // 4,116 news_items. Narrowing here is what stops listAllEntities walking 20
  // pages and truncating at 1,000.
  it('names the tenant backend attr.<name>__gte filter', () => {
    expect(recencyFilters('published_at', { days: 7 }, NOW)).toEqual({
      'attr.published_at__gte': '2026-08-17',
    });
  });

  it('is empty for ALL — no window, no narrowing', () => {
    expect(recencyFilters('published_at', { days: null }, NOW)).toEqual({});
  });

  it('is empty when the type declares no recency attribute', () => {
    // There is no server-side filter on created_at, so a type without a declared
    // date attribute cannot be narrowed remotely — the window falls back to the
    // client-side pass over createdAt.
    expect(recencyFilters(null, { days: 7 }, NOW)).toEqual({});
  });

  it('uses the same cutoff instant the client-side pass uses', () => {
    const cutoff = recencyFilters('published_at', { days: 30 }, NOW)['attr.published_at__gte'];
    const kept = applyRecencyWindow(
      [
        { id: 1, entityType: 'news_item', externalId: null, name: 'on the boundary',
          data: { publishedAt: cutoff }, createdAt: '2026-08-24T00:00:00Z' },
      ],
      { days: 30 },
      'published_at',
      NOW,
    );
    expect(kept).toHaveLength(1);
  });
});
