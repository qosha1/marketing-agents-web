import { describe, it, expect } from 'vitest';
import { CONTENT_TYPE_ATTR, CONTENT_TYPE_KEY } from '../content';
import { boardViewHref, tableViewHref, type ToggleParams } from '../view-toggle';

/**
 * The Board-view / Table-view round trip must keep the tab you were in
 * (bd startsim-flv2x.1).
 *
 * "Weekly Briefs" is not a page — it is /t/topic?content_type=weekly_brief, a
 * scope. Both toggles dropped that scope, so pressing "Board view" from Weekly
 * Briefs landed you on a board of all 82 topics with the three kinds mixed
 * into shared status lanes, and pressing "Table view" to come back dropped it
 * again. The round trip could not hold scope in either direction.
 *
 * WHY THIS FILE DOES NOT ASSERT ON contentBoardHref. lib/__tests__/content.test.ts
 * already tests that helper in isolation and it PASSES — the helper has always
 * returned the right URL. The defect is that the two toggles never called it.
 * A test of the helper is green while the button is wrong, so these assertions
 * are on what the CALL SITES resolve to: the pure functions the two pages now
 * render their links from.
 *
 * WHY `status` IS ASSERTED TO BE DROPPED. startsim-flv2x.2 ruled on this
 * (Option 1: two routes sharing scope; content_type travels both ways, status
 * does not travel into the board). It is a demonstrated defect, not a taste:
 *
 *   lanes.ts:57  laneFilters returns { ...base, ['attr.' + statusName]: laneId }
 *                — the lane's own value is applied LAST, deliberately, so every
 *                lane OVERRIDES an incoming ?status=. The lanes ignore it.
 *   board :243   totalQuery = countEntities(typeKey, baseFilters) — does NOT.
 *   board :314   filters.map renders every facet as a header chip, status too.
 *
 * So ?status=ready on the board renders a chip claiming a filter that is not
 * applied, over a header measured live as "41 of 1 records" — a second number
 * SMALLER than the first. That is broken on the board TODAY, independent of
 * this bug (filed as startsim-flv2x.7); carrying status would newly expose it
 * on a common path. content_type is safe for the mirror-image reason: it is
 * not the status attribute, so laneFilters never overwrites it, every lane
 * query carries it, and the count agrees.
 *
 * STILL NOT ASSERTED: the board-only params (`since`, `assignee_sub`).
 * flv2x.2 ruled they do not travel out of the board, but the seam drops every
 * param today, so an assertion there would not be red and is not this bead's
 * to pin. flv2x.3 inherits the ruling.
 */

/** The content scope a candidate href actually lands you in — null for none. */
function scopeOf(href: string): string | null {
  return paramsOf(href).get(CONTENT_TYPE_ATTR);
}

/** The query a candidate href carries, so one hop's output can feed the next. */
function paramsOf(href: string): URLSearchParams {
  const q = href.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : href.slice(q + 1));
}

const STATUS_ATTR = 'status';
const weeklyBriefs: ToggleParams = { [CONTENT_TYPE_ATTR]: 'weekly_brief' };

describe('THE REQUIREMENT: switching presentation keeps the records you were looking at', () => {
  // These four assertions are about SCOPE, not about URLs. They hold whether
  // the board stays a sibling route or becomes a mode of the table
  // (startsim-flv2x.2) — under one route the target would be
  // /t/topic?content_type=weekly_brief&view=board and scopeOf still reads
  // weekly_brief out of it.

  it('from Weekly Briefs, the Board-view target still shows only weekly briefs', () => {
    expect(scopeOf(boardViewHref(CONTENT_TYPE_KEY, weeklyBriefs))).toBe('weekly_brief');
  });

  it('from a weekly-brief board, the Table-view target still shows only weekly briefs', () => {
    expect(scopeOf(tableViewHref(CONTENT_TYPE_KEY, weeklyBriefs))).toBe('weekly_brief');
  });

  it('survives the whole round trip: table -> board -> table', () => {
    const board = boardViewHref(CONTENT_TYPE_KEY, weeklyBriefs);
    const backToTable = tableViewHref(CONTENT_TYPE_KEY, Object.fromEntries(paramsOf(board)));
    expect(scopeOf(backToTable)).toBe('weekly_brief');
  });

  it('survives the whole round trip the other way: board -> table -> board', () => {
    const table = tableViewHref(CONTENT_TYPE_KEY, weeklyBriefs);
    const backToBoard = boardViewHref(CONTENT_TYPE_KEY, Object.fromEntries(paramsOf(table)));
    expect(scopeOf(backToBoard)).toBe('weekly_brief');
  });

  // The guard on the fix, and it passes today: a view that is not scoped to a
  // content kind must not acquire one on the way across. news_item declares no
  // content_type at all, so inventing the param would filter a board down to
  // nothing.
  it('does not invent a scope for a view that has none', () => {
    expect(scopeOf(boardViewHref('news_item', {}))).toBeNull();
    expect(scopeOf(tableViewHref('news_item', {}))).toBeNull();
  });

  // The two assertions here do different jobs, and the file needs both to
  // discriminate "carry content_type" from "carry every param". The first
  // fails today (the scope is dropped). The second passes today and is the
  // anti-carry-all guard: a fix that simply forwards the whole query string
  // would satisfy every other test in this file and ship the "41 of 1 records"
  // header described above.
  it('does not carry status into the board, where the lanes ARE status', () => {
    const href = boardViewHref(CONTENT_TYPE_KEY, { ...weeklyBriefs, [STATUS_ATTR]: 'ready' });
    expect(scopeOf(href)).toBe('weekly_brief');
    expect(paramsOf(href).get(STATUS_ATTR)).toBeNull();
  });
});

describe('THE ROUTE SHAPE: two sibling routes over one scope', () => {
  // These two exact-URL assertions are the only part of this file that assumes
  // the board stays its own route. If startsim-flv2x.2 rules that the board
  // becomes a MODE of the table, re-point these two and leave the requirement
  // block above untouched.

  it('Board view from Weekly Briefs goes to the weekly-brief board', () => {
    expect(boardViewHref(CONTENT_TYPE_KEY, weeklyBriefs)).toBe('/board/topic?content_type=weekly_brief');
  });

  it('Table view from the weekly-brief board goes back to Weekly Briefs', () => {
    expect(tableViewHref(CONTENT_TYPE_KEY, weeklyBriefs)).toBe('/t/topic?content_type=weekly_brief');
  });

  // Passes today. An unscoped view keeps its bare href — no stray `?`, nothing
  // for the fix to invent.
  it('an unscoped view keeps the bare href in both directions', () => {
    expect(boardViewHref('news_item', {})).toBe('/board/news_item');
    expect(tableViewHref('news_item', {})).toBe('/t/news_item');
  });
});
