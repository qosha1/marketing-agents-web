/**
 * Per-lane pagination (bd startsim-wn2p.27).
 *
 * The window (wn2p.24) narrowed the fetch to 1,135 records, but still pulled all
 * of them before a card rendered — and 808 landed in one lane. The window was
 * the wrong axis on its own; the right one is per lane.
 */
import { describe, it, expect } from 'vitest';
import {
  laneFilters,
  lanePages,
  assembleLanes,
  lanePageRequests,
  unaccountedFor,
  withOneMorePage,
} from '../lanes';
import { UNSET_COLUMN } from '../board';

const BASE = { 'attr.published_at__gte': '2026-08-10' };

describe('laneFilters', () => {
  it('selects exactly one lane, on top of the board-wide filters', () => {
    // Measured live: this pair returns count 808 of the window's 1,135.
    expect(laneFilters('status', 'rejected', BASE)).toEqual({
      'attr.published_at__gte': '2026-08-10',
      'attr.status': 'rejected',
    });
  });

  it('works with no board-wide filters', () => {
    expect(laneFilters('status', 'new', {})).toEqual({ 'attr.status': 'new' });
  });

  it('is null for the Unset lane, which no query can express', () => {
    // `attr.status__isnull=true` returns 0 on the live tenant: isnull answers
    // "is there an Attribute row", not "is the value blank". There is no filter
    // for "status present but empty, or not a declared choice", so this lane is
    // reported as a residual rather than fetched. Never silently as zero.
    expect(laneFilters('status', UNSET_COLUMN.id, BASE)).toBeNull();
  });

  it('does not let a lane id overwrite a board-wide filter on the same attribute', () => {
    // A board pre-filtered to ?status=surfaced still lays out every lane; the
    // lane's own value has to win for its own query or every lane would return
    // the same records.
    expect(laneFilters('status', 'rejected', { 'attr.status': 'surfaced' })).toEqual({
      'attr.status': 'rejected',
    });
  });
});

describe('lanePages', () => {
  it('starts every lane at one page', () => {
    expect(lanePages({}, 'rejected')).toBe(1);
  });

  it('remembers a lane that has been scrolled', () => {
    expect(lanePages({ rejected: 4 }, 'rejected')).toBe(4);
  });

  it('advances one lane and leaves its neighbours alone', () => {
    const next = withOneMorePage({ rejected: 2, ignored: 1 }, 'rejected');
    expect(next).toEqual({ rejected: 3, ignored: 1 });
  });

  it('advances a lane that has never been scrolled', () => {
    expect(withOneMorePage({}, 'new')).toEqual({ new: 2 });
  });

  it('returns a new object, so react-query sees the key change', () => {
    const before = { rejected: 1 };
    const after = withOneMorePage(before, 'rejected');
    expect(after).not.toBe(before);
    expect(before).toEqual({ rejected: 1 });
  });
});

describe('unaccountedFor — the Unset residual', () => {
  it('is what the lane queries cannot explain', () => {
    // 1,135 in the window; the seven declared lanes account for 1,134; one
    // record carries a status no lane names.
    expect(unaccountedFor(1135, [23, 31, 86, 21, 165, 808, 0])).toBe(1);
  });

  it('is zero when every record sits in a declared lane', () => {
    expect(unaccountedFor(1134, [23, 31, 86, 21, 165, 808, 0])).toBe(0);
  });

  it('never goes negative while lane counts are still arriving', () => {
    expect(unaccountedFor(100, [50, 80])).toBe(0);
  });

  it('claims nothing until the total is known', () => {
    expect(unaccountedFor(null, [23, 31])).toBe(0);
    expect(unaccountedFor(undefined, [23, 31])).toBe(0);
  });
});

describe('lanePageRequests', () => {
  const columns = [
    { id: 'new', label: 'new' },
    { id: 'rejected', label: 'rejected' },
    UNSET_COLUMN,
  ];

  it('asks for one request per lane per page it has scrolled to', () => {
    const reqs = lanePageRequests(columns, 'status', { rejected: 3 }, BASE);
    expect(reqs.map((r) => `${r.laneId}:${r.page}`)).toEqual([
      'new:1',
      'rejected:1',
      'rejected:2',
      'rejected:3',
    ]);
  });

  it('never asks for the Unset lane, which no query can express', () => {
    const reqs = lanePageRequests(columns, 'status', {}, BASE);
    expect(reqs.some((r) => r.laneId === UNSET_COLUMN.id)).toBe(false);
  });

  it('carries the lane filter and the board filters on every request', () => {
    const reqs = lanePageRequests(columns, 'status', { rejected: 2 }, BASE);
    for (const r of reqs) {
      expect(r.filters['attr.published_at__gte']).toBe('2026-08-10');
      expect(r.filters['attr.status']).toBe(r.laneId);
    }
  });

  it('gives each page its own identity — page 3 must not re-fetch pages 1 and 2', () => {
    // The whole point of this shape. The first cut keyed a query by the lane's
    // PAGE COUNT and re-walked from page 1 on every load-more: reaching page 4
    // cost four requests and page 10 cost ten, on a board whose entire reason to
    // exist is not over-fetching.
    const reqs = lanePageRequests(columns, 'status', { rejected: 3 }, BASE);
    const pages = reqs.filter((r) => r.laneId === 'rejected').map((r) => r.page);
    expect(new Set(pages).size).toBe(pages.length);
  });

  it('yields nothing when the type declares no status attribute', () => {
    expect(lanePageRequests(columns, '', {}, BASE)).toEqual([]);
  });
});

describe('assembleLanes', () => {
  const columns = [
    { id: 'new', label: 'new' },
    { id: 'rejected', label: 'rejected' },
    UNSET_COLUMN,
  ];
  const rec = (id: number) => ({
    id, entityType: 'news_item', externalId: null, name: 'r' + id, data: {}, createdAt: '2026-08-20',
  });

  it('concatenates a lane pages in order', () => {
    const reqs = lanePageRequests(columns, 'status', { rejected: 2 }, BASE);
    const results = [
      { data: { count: 23, next: null, previous: null, results: [rec(1)] } },
      { data: { count: 808, next: 'p2', previous: null, results: [rec(2)] } },
      { data: { count: 808, next: 'p3', previous: null, results: [rec(3)] } },
    ];
    const lanes = assembleLanes(columns, reqs, results);
    expect(lanes.rejected.records.map((r) => r.id)).toEqual([2, 3]);
    expect(lanes.new.records.map((r) => r.id)).toEqual([1]);
  });

  it('reports the SERVER count, not the number loaded', () => {
    const reqs = lanePageRequests(columns, 'status', {}, BASE);
    const results = [
      { data: { count: 23, next: null, previous: null, results: [rec(1)] } },
      { data: { count: 808, next: 'p2', previous: null, results: [rec(2)] } },
    ];
    const lanes = assembleLanes(columns, reqs, results);
    expect(lanes.rejected.count).toBe(808);
    expect(lanes.rejected.records).toHaveLength(1);
  });

  it('takes hasMore from the LAST page fetched, not the first', () => {
    const reqs = lanePageRequests(columns, 'status', { rejected: 2 }, BASE);
    const results = [
      { data: { count: 23, next: null, previous: null, results: [] } },
      { data: { count: 60, next: 'p2', previous: null, results: [rec(2)] } },
      { data: { count: 60, next: null, previous: null, results: [rec(3)] } },
    ];
    expect(assembleLanes(columns, reqs, results).rejected.hasMore).toBe(false);
  });

  it('gives the Unset lane an entry so the board still lays it out', () => {
    const lanes = assembleLanes(columns, lanePageRequests(columns, 'status', {}, BASE), []);
    expect(lanes[UNSET_COLUMN.id]).toEqual({ records: [], count: 0, hasMore: false, loading: false });
  });

  it('is loading while any of a lane pages is in flight', () => {
    const reqs = lanePageRequests(columns, 'status', { rejected: 2 }, BASE);
    const results = [
      { data: { count: 23, next: null, previous: null, results: [] } },
      { data: { count: 60, next: 'p2', previous: null, results: [rec(2)] } },
      { isFetching: true },
    ];
    expect(assembleLanes(columns, reqs, results).rejected.loading).toBe(true);
    expect(assembleLanes(columns, reqs, results).new.loading).toBe(false);
  });

  it('survives a page that has not resolved yet', () => {
    const reqs = lanePageRequests(columns, 'status', { rejected: 2 }, BASE);
    const lanes = assembleLanes(columns, reqs, [{}, {}, {}]);
    expect(lanes.rejected).toEqual({ records: [], count: 0, hasMore: false, loading: false });
  });
});
