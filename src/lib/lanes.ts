/**
 * Per-lane pagination for the status board (bd startsim-wn2p.27).
 *
 * WHY THIS EXISTS. wn2p.24 gave the board a recency window, which cut
 * /board/news_item from 4,116 records to 1,135 by narrowing the FETCH rather
 * than the render. It still pulled all 1,135 before a card appeared, and 808 of
 * them landed in a single lane nobody scrolls. The window was the right idea on
 * the wrong axis: a board is read one COLUMN at a time, so a column is what
 * should paginate.
 *
 * So each lane is its own query. Page load asks every lane for its first 50 in
 * parallel; scrolling a lane to the bottom asks that lane, and only that lane,
 * for its next 50. The DRF envelope hands back the lane's TRUE total alongside,
 * which is a second win: the header badge stops meaning "how many are loaded"
 * and starts meaning "how many there are".
 *
 * Everything here is pure. The effectful shell — `useQueries` over the lanes,
 * the scroll sentinel — lives in the board page and EntityBoard.
 */
import { UNSET_COLUMN } from '@/lib/board';
import type { EntityFilters } from '@/lib/foundry-api';

/**
 * Rows per lane request.
 *
 * 50 is the backend's own page size, and roughly two screens of cards — enough
 * that a lane rarely needs a second page to be useful, small enough that seven
 * of them in parallel is a fraction of the 1,135 the board used to fetch.
 */
export const LANE_PAGE_SIZE = 50;

/**
 * Server-side filters selecting exactly one lane, or `null` when the lane
 * cannot be expressed as a query.
 *
 * The lane's own value is applied LAST and deliberately: a board pre-filtered to
 * `?status=surfaced` still lays out every lane, and if the board-wide filter won
 * on the status attribute then every lane would return the same records.
 *
 * VERIFIED live 2026-08-24 against marketing-agents:
 *   attr.status=rejected + attr.published_at__gte=2026-08-10  ->  count 808
 *   attr.status=new      + the same window                    ->  count 23
 * Both match what the un-paginated board rendered, so the split is lossless.
 */
export function laneFilters(
  statusAttrName: string,
  laneId: string,
  base: EntityFilters,
): EntityFilters | null {
  // The Unset lane holds records whose status is blank, absent, or not one of
  // the declared choices. No filter finds them: the backend's `__isnull` asks
  // "is there an Attribute row", not "is the value blank", and it returns 0 on
  // a tenant where every row has one. Rather than fetch a lane's worth of
  // nothing and call it empty, this lane is reported as a RESIDUAL — see
  // {@link unaccountedFor}.
  if (laneId === UNSET_COLUMN.id) return null;
  return { ...base, [`attr.${statusAttrName}`]: laneId };
}

/** How many pages each lane has asked for. Absent means one — the first page. */
export type LanePages = Record<string, number>;

/** The page count for one lane; every lane starts at its first page. */
export function lanePages(pages: LanePages, laneId: string): number {
  return pages[laneId] ?? 1;
}

/**
 * One more page for one lane. Returns a NEW object because the page count is
 * part of that lane's query key — mutating in place would leave react-query
 * holding the old key and the scroll would appear to do nothing.
 */
export function withOneMorePage(pages: LanePages, laneId: string): LanePages {
  return { ...pages, [laneId]: lanePages(pages, laneId) + 1 };
}

/**
 * How many records the lane queries cannot account for — the true size of the
 * Unset lane, arrived at by subtraction because it cannot be arrived at by
 * query.
 *
 * The point is that it can never be silently zero. A record carrying a retired
 * status value is exactly the case that lands here: the four retired draft
 * values are still declared (so they still get lanes of their own), but a value
 * the schema does not declare at all has no lane, and without this residual it
 * would simply vanish from the board. That is the same defect class as the
 * truncation wn2p.24 removed, and it is not being reintroduced.
 *
 * Zero while the total is still unknown, and never negative while lane counts
 * are still arriving — a transient "-3 unaccounted for" is a worse lie than
 * waiting a beat.
 */
export function unaccountedFor(
  total: number | null | undefined,
  laneCounts: number[],
): number {
  if (total == null) return 0;
  const accounted = laneCounts.reduce((sum, n) => sum + n, 0);
  return Math.max(0, total - accounted);
}

/** One page of one lane — the unit that is fetched and cached. */
export interface LanePageRequest {
  laneId: string;
  /** 1-based, matching the backend's own page numbering. */
  page: number;
  filters: EntityFilters;
}

/**
 * Every (lane, page) a board currently wants.
 *
 * ONE REQUEST PER PAGE, and that is the whole design. The first cut of this
 * keyed a lane's query by its page COUNT and re-walked from page 1 on every
 * load-more — reaching page 4 cost four requests and page 10 would cost ten, on
 * a board whose entire reason to exist is not over-fetching. Measured on the
 * live board before the fix: scrolling one lane to page 4 fired 1+2+3+4 = 10
 * requests. Giving each page its own identity makes page 1 cacheable forever and
 * a load-more exactly one request.
 *
 * The Unset lane is skipped entirely — see {@link laneFilters}.
 */
export function lanePageRequests(
  columns: { id: string }[],
  statusAttrName: string,
  pages: LanePages,
  base: EntityFilters,
): LanePageRequest[] {
  if (!statusAttrName) return [];
  const out: LanePageRequest[] = [];
  for (const col of columns) {
    const filters = laneFilters(statusAttrName, col.id, base);
    if (!filters) continue;
    for (let page = 1; page <= lanePages(pages, col.id); page++) {
      out.push({ laneId: col.id, page, filters });
    }
  }
  return out;
}

/** The part of a react-query result this module reads. Structural, so the test
 *  can hand in plain objects and the page can hand in the real thing. */
export interface LanePageResult {
  data?: {
    count?: number;
    next?: string | null;
    results?: unknown[];
  };
  isFetching?: boolean;
}

/** What one lane knows about itself, assembled from its pages. */
export interface LaneState {
  records: import('@/lib/foundry-api').EntityRecord[];
  /** How many exist on the server — not how many are loaded. */
  count: number;
  hasMore: boolean;
  loading: boolean;
}

/**
 * Fold per-page results back into one state per lane, in page order.
 *
 * `count` comes from the envelope rather than from `records.length`, and
 * `hasMore` from the LAST page fetched rather than the first — a lane that has
 * paged to its end must stop asking, and reading `next` off page 1 would keep it
 * asking forever.
 *
 * Every column gets an entry, including Unset, so the board lays out its full
 * set of lanes whether or not anything was fetched for them.
 */
export function assembleLanes(
  columns: { id: string }[],
  requests: LanePageRequest[],
  results: LanePageResult[],
): Record<string, LaneState> {
  const out: Record<string, LaneState> = {};
  for (const col of columns) {
    out[col.id] = { records: [], count: 0, hasMore: false, loading: false };
  }
  requests.forEach((req, i) => {
    const lane = out[req.laneId];
    if (!lane) return;
    const res = results[i];
    if (res?.isFetching) lane.loading = true;
    const data = res?.data;
    if (!data) return;
    lane.records.push(...((data.results ?? []) as LaneState['records']));
    lane.count = data.count ?? lane.count;
    // Last page wins: the requests for one lane are emitted in page order.
    lane.hasMore = Boolean(data.next);
  });
  return out;
}
