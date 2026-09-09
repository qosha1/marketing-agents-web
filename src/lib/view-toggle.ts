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
 * without rendering a component — it is a pure (typeKey, params) -> href
 * question, and the answer should not need a document to check. (When this was
 * written the harness could not have rendered one anyway: it was a single
 * `environment: 'node'` run over `.test.ts`. startsim-edb00 has since added a
 * second jsdom lane for `.test.tsx`, so that is no longer the CONSTRAINT it
 * once was — but the node lane is still where a pure decision belongs.)
 *
 * THAT IS FIXED (startsim-flv2x.3, PR #45), and the paragraph above is kept in
 * the past tense rather than deleted: a one-line array is not self-evidently a
 * decision, and the next reader to ask "why not just forward the query string?"
 * needs the answer sitting next to it. Both pages now render their link from
 * the functions below — table page :686, board page :419 — so there is one
 * place where the question is answered and no inline spellings left.
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
 * THIS WAS ONCE EMPTY, AND THAT WAS THE BUG (startsim-flv2x.1): the scope you
 * picked was thrown away by the very control that claims to show you the same
 * records a different way. It stays an ALLOWLIST rather than becoming a
 * pass-through — the two rulings below are each a param that must NOT travel,
 * and forwarding the query string wholesale would carry both.
 *
 * `content_type` is the unambiguous member: it names a content KIND, both
 * pages already consume it (the table seeds its Kind facet from it, the board
 * feeds it to pickAttrFilters), and lib/content.ts has returned the correctly
 * scoped href for a year — the toggles just never called it.
 *
 * `status` IS DECIDED, AND THE ANSWER IS NO — it must never be added to this
 * list (ruled on startsim-flv2x.2).
 *
 * THE REASON, WHICH STANDS ON ITS OWN: carrying it would mean nothing. The
 * board's LANES are status — lanes.ts:57 builds each lane's query as
 * `{ ...base, ['attr.' + statusName]: laneId }`, applying the lane's own value
 * LAST and deliberately — so an incoming ?status= cannot narrow anything a
 * reader can see. It would be a param in the URL that changes no pixel.
 * flv2x.2 weighed the only alternative that would give it a meaning, narrowing
 * the board to the one named lane, and rejected it: a one-lane kanban is a
 * worse table with none of the table's columns.
 *
 * AND THE HISTORICAL REASON, recorded because this comment used to LEAD with it
 * and a reader checking it against the code will find it describes nothing
 * (startsim-flv2x.11). Until startsim-flv2x.7 (PR #47) the lane attribute was
 * refused by the lanes but not by the header chip (board page :314) or the
 * matching count (board page :243, countEntities over baseFilters), so
 * ?status= drew a chip claiming a filter that was not applied, above a header
 * measured live as "41 of 1 records" — a second number smaller than the first.
 * boardAttrFilters now splits the lane attribute off before it reaches either,
 * so carrying status would be HARMLESS today. Harmless is not a reason to
 * carry it. The ruling never rested on the defect and does not lapse with it.
 *
 * `content_type` is safe for the mirror-image reason: it is NOT the status
 * attribute, so laneFilters never overwrites it — it stays in `base`, every
 * lane query carries it, and the count agrees.
 *
 * `since` AND `assignee_sub` DO NOT TRAVEL EITHER — but the reason once given
 * for `since`, that the table has no control to render it into, is no longer
 * true. /t/draft now opens on a recency window and renders it as its own chip
 * (lib/drafts-view.ts, startsim-f4lac), reusing this exact param name from
 * lib/board.ts. The two surfaces share a spelling and NOT a default: the
 * drafts table opens at DRAFTS_DEFAULT_DAYS = 7, a board at
 * DEFAULT_RECENCY_DAYS = 14. So a flat, direction-SYMMETRIC allowlist cannot
 * take `since` without also carrying a window the BOARD chose back onto a
 * table where nobody chose it — trading one silent narrowing for another.
 * `assignee_sub` is board-only outright; the table has no such control.
 *
 * WHAT THAT LEAVES OPEN, measured live 2026-09-09 and filed rather than fixed
 * here: /t/draft's three-part default (`topic` + `since` + `made`) is dropped
 * on the way to the board — correctly, since the board applies none of it —
 * and then the bare return href lets it RE-APPLY. Widen to the whole pipeline
 * with the "N hidden" disclosure and one round trip through the board puts you
 * silently back behind the default (156 total -> board -> "36 shown · 120
 * hidden"). Closing that needs a direction-AWARE seam, which reshapes what
 * flv2x.2 settled, so it is startsim-flv2x.12 rather than three more strings
 * in this array.
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
