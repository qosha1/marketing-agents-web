/**
 * Where the "Board view" / "Table view" toggle takes you (bd startsim-flv2x).
 *
 * The two presentations of one type live at sibling routes — /t/<typeKey> lays
 * the records out as a table, /board/<typeKey> lays the same records out as
 * status lanes — and each page renders a link to the other. That link is a
 * DECISION, not a string: it has to answer "which of the filters I am looking
 * through describe WHICH RECORDS, and so must come with me?"
 *
 * Both pages used to answer it inline, and both answered "none": the table's
 * toggle was `/board/${encodeURIComponent(typeKey)}` and the board's was
 * `/t/${typeKey}`, neither carrying a query string. So "Weekly Briefs" — which
 * IS /t/topic?content_type=weekly_brief — sent you to a board of all 82 topics
 * with the three kinds mixed into shared status lanes, and the trip back
 * dropped the scope again. The decision is extracted here so it is testable
 * without rendering a component (the harness is vitest `environment: 'node'`,
 * `.test.ts` only — there is no jsdom and no testing-library).
 *
 * THIS MODULE STILL CARRIES THE BUG. It is a faithful characterization of what
 * the two buttons do today, so the extraction can be proved behaviour-neutral;
 * the fix is startsim-flv2x.3 and lives in TRAVELLING_PARAMS below.
 *
 * NOTE ON ENCODING: the table's toggle ran typeKey through encodeURIComponent
 * and the board's did not. Both do here. That is a no-op for every schema key
 * that exists (they are snake_case identifiers), so it changes no live URL —
 * but the board page's bare interpolation was an inconsistency, not an
 * intention, and it is not worth preserving.
 */

import { CONTENT_TYPE_ATTR } from './content';
export type ToggleParams = Record<string, string | undefined | null>;

/**
 * The params that describe WHICH RECORDS you are looking at, and so must
 * survive a switch between the two presentations.
 *
 * TODAY THIS IS EMPTY, AND THAT IS THE BUG (startsim-flv2x.1). The scope you
 * picked is thrown away by the very control that claims to show you the same
 * records a different way.
 *
 * `content_type` is the unambiguous member: it names a content KIND, both
 * pages already consume it (the table seeds its Kind facet from it, the board
 * feeds it to pickAttrFilters), and lib/content.ts has returned the correctly
 * scoped href for a year — the toggles just never called it.
 *
 * `status` IS DECIDED, AND THE ANSWER IS NO — it must never be added to this
 * list (ruled on startsim-flv2x.2). The board's LANES are status, and
 * lanes.ts:57 applies each lane's own value LAST, so every lane overrides an
 * incoming ?status= and ignores it. But the header chip (board page :314) and
 * the matching count (board page :243, countEntities over baseFilters) do NOT
 * ignore it. Carrying it renders a chip claiming a filter that is not applied,
 * above a header measured live as "41 of 1 records" — a second number smaller
 * than the first. That board bug exists today and is startsim-flv2x.7's;
 * carrying status here would newly expose it on a common path.
 *
 * `content_type` is safe for the mirror-image reason: it is NOT the status
 * attribute, so laneFilters never overwrites it — it stays in `base`, every
 * lane query carries it, and the count agrees.
 *
 * The board-only params (`since`, `assignee_sub`) do not travel out of the
 * board either: the table has no control to render them into.
 */
const TRAVELLING_PARAMS: readonly string[] = [CONTENT_TYPE_ATTR];

/**
 * The two route bases the toggle switches between. Named ONCE: the hrefs below
 * and `canonicalViewPath` all read them, so the sibling relationship cannot
 * drift into two spellings inside its own module — which is exactly how the
 * sidebar came to disagree with the toggle (startsim-flv2x.10).
 */
const BOARD_BASE = '/board';
const TABLE_BASE = '/t';

/**
 * One path for both presentations of the same records: a board path folded onto
 * its table sibling, everything else returned unchanged.
 *
 *   /board/topic  ->  /t/topic          /t/topic  ->  /t/topic (unchanged)
 *   /settings     ->  /settings
 *
 * WHY THIS LIVES HERE. It is the same fact the two hrefs above encode — that
 * /t/<type> and /board/<type> are one thing seen two ways — asked as a question
 * instead of built as a URL. Anything that needs to know whether two locations
 * are "the same place" (the sidebar's active test, today) reads it from this
 * module rather than re-deriving it, so there is one place to change if the
 * board ever stops being a sibling route (startsim-flv2x.2 left that open).
 *
 * It is deliberately PURELY SYNTACTIC — no schema, no `typeRoute`, no
 * `isBoardType`. Whether a type is board-first decides which href its nav item
 * gets; it has nothing to do with whether two paths address the same records,
 * and reaching for the schema here would couple the sidebar to board.ts for no
 * gain.
 *
 * The trailing slash in the prefix test is load-bearing: `/boardroom` is not a
 * board, and folding it to `/troom` would be the mirror of the `/t/topicality`
 * false match nav-active.ts already guards against.
 */
export function canonicalViewPath(path: string): string {
  if (path === BOARD_BASE) return TABLE_BASE;
  if (path.startsWith(`${BOARD_BASE}/`)) return TABLE_BASE + path.slice(BOARD_BASE.length);
  return path;
}

function siblingHref(base: string, typeKey: string, params: ToggleParams): string {
  const carried = new URLSearchParams();
  for (const name of TRAVELLING_PARAMS) {
    const value = params[name];
    if (value != null && value !== '') carried.set(name, String(value));
  }
  const path = `${base}/${encodeURIComponent(typeKey)}`;
  const qs = carried.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Where the table's "Board view" button goes, given the params the table is
 * currently filtered by.
 */
export function boardViewHref(typeKey: string, params: ToggleParams): string {
  return siblingHref(BOARD_BASE, typeKey, params);
}

/**
 * Where the board's "Table view" link goes, given the params the board is
 * currently filtered by.
 */
export function tableViewHref(typeKey: string, params: ToggleParams): string {
  return siblingHref(TABLE_BASE, typeKey, params);
}
