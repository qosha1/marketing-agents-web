/**
 * Per-lane pagination (bd startsim-wn2p.27).
 *
 * The window (wn2p.24) narrowed the fetch to 1,135 records, but still pulled all
 * of them before a card rendered — and 808 landed in one lane. The window was
 * the wrong axis on its own; the right one is per lane.
 */
import { describe, it, expect } from 'vitest';
import {
  LANE_PAGE_SIZE,
  laneFilters,
  lanePages,
  loadedIn,
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

describe('loadedIn', () => {
  it('counts what a lane has actually fetched', () => {
    expect(loadedIn(3)).toBe(3 * LANE_PAGE_SIZE);
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
