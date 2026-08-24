'use client';

/**
 * Generic status-board page for any entity type (bd ogmc-9ms.1.7/.1.9). Groups
 * the type's records into lanes by its status enum and opens a detail/edit drawer
 * on click. Falls back to a pointer to the table view for types without a status
 * field. Reusable across tenants — the route is /board/<typeKey>.
 *
 * Pre-filterable by any declared ENUM attribute (?<attrName>=<value>, one per
 * declared enum, ANDed — startsim-uhmk), generalized from the old
 * content_type-only hand-rolled filter to the shared pickAttrFilters/
 * applyAttrFilters mechanism (same one the table already used). The topic
 * board additionally renders on-page category tabs (Weekly Briefs / Lead
 * Magnets / General) that pre-filter it the same way, plus a separate
 * free-text `assignee_sub` quick-filter (startsim-a2oq: "assigned to me" /
 * "unassigned" / anyone) shown only when the type declares that attribute.
 *
 * Every board also opens on a RECENCY WINDOW (startsim-wn2p.24) — the last 14
 * days by default, `?since=` to widen, `?since=all` for the old behaviour. A
 * board is a work surface, not an archive: news_item alone holds 4,116 records
 * and rendering all of them buried the 31 anyone is actually triaging.
 *
 * The window narrows the FETCH, not just the render, wherever the type declares
 * a date the backend can filter on. That matters more than the decluttering: at
 * 20 pages x 50 rows the old unfiltered fetch never reached past the newest
 * 1,000 records anyway, and reported that truncated set as the whole type.
 *
 * AND EACH LANE PAGES ITSELF (startsim-wn2p.27). The window alone still pulled
 * its whole 1,135 up front, 808 of them into one lane. So the board's data is a
 * query PER LANE — every lane asks for its first 50 in parallel on mount, and
 * scrolling a lane to its end asks that lane alone for its next 50. Every filter
 * on this page (the window, the enum facets, the assignee) folds into those lane
 * queries rather than being applied to a big list afterwards.
 */
import { useCallback, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { EntityBoard, type LaneState } from '@/components/entity-board';
import { EntityDetailDrawer } from '@/components/entity-detail-drawer';
import {
  boardColumns,
  BLANK,
  pickAttrFilters,
  pickRecencyAttr,
  pickRecencyWindow,
  pickStatusAttr,
  pickTextAttrFilter,
  UNSET_COLUMN,
  RECENCY_ALL,
  RECENCY_PARAM,
  RECENCY_WINDOWS,
  defaultRecencyDays,
  facetFilters,
  recencyFilters,
  rollupByParent,
  type RollupCounts,
} from '@/lib/board';
import {
  CONTENT_CATEGORIES,
  CONTENT_TYPE_ATTR,
  CONTENT_TYPE_KEY,
  contentBoardHref,
  contentCategoryLabel,
} from '@/lib/content';
import { DRAFT_TYPE, listAllRelationships, topicIdForDraft } from '@/lib/topic-drafts';
import {
  countEntities,
  fetchEntityPages,
  getEntity,
  listAllEntities,
  listTypes,
  whoami,
  type EntityPageSlice,
  type EntityRecord,
} from '@/lib/foundry-api';
import {
  LANE_PAGE_SIZE,
  laneFilters,
  lanePages,
  unaccountedFor,
  withOneMorePage,
  type LanePages,
} from '@/lib/lanes';

const ASSIGNEE_SUB_ATTR = 'assignee_sub';
/**
 * The status a draft counts toward in the "N/total approved" rollup chip.
 *
 * `approved` is the team's word for a human having signed the piece off — the
 * old `ready` meant the same thing and was renamed in bd startsim-wn2p.2. It is
 * NOT `ready_for_review`, which is where every draft starts.
 */
const DRAFT_DONE_STATUS = 'approved';

export default function BoardPage() {
  const params = useParams<{ typeKey: string }>();
  const typeKey = String(params.typeKey);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const qc = useQueryClient();
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const type = typesQuery.data?.results.find((t) => t.key === typeKey);

  // The recency window (startsim-wn2p.24). `recencyAttr` is null for a type that
  // declares no "when this happened" date; the window then measures by each
  // record's own createdAt, client-side — so this is on for every board, not
  // just news. It is computed BEFORE the fetch because it narrows the fetch.
  const recencyAttr = useMemo(() => pickRecencyAttr(type), [type]);
  const recency = useMemo(
    () => pickRecencyWindow(Object.fromEntries(searchParams.entries()), defaultRecencyDays(recencyAttr)),
    [searchParams, recencyAttr],
  );
  const recencyQuery = useMemo(
    () => recencyFilters(recencyAttr, recency),
    [recencyAttr, recency],
  );
  // Generic ?<enumAttr>=<value> filters (any number, ANDed) — replaces the old
  // content_type-only hand-rolled filter; content_type is just one enum among
  // however many the type declares.
  const filters = useMemo(
    () => pickAttrFilters(type, Object.fromEntries(searchParams.entries())),
    [type, searchParams],
  );

  const hasAssigneeAttr = useMemo(
    () => (type?.attributes ?? []).some((a) => a.name === ASSIGNEE_SUB_ATTR && a.dataType !== 'enum'),
    [type?.attributes],
  );
  const assigneeFilter = useMemo(
    () => pickTextAttrFilter(type, ASSIGNEE_SUB_ATTR, Object.fromEntries(searchParams.entries())),
    [type, searchParams],
  );
  const whoamiQuery = useQuery({ queryKey: ['whoami'], queryFn: () => whoami(), enabled: hasAssigneeAttr });

  function setRecencyParam(days: number | null) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set(RECENCY_PARAM, days == null ? RECENCY_ALL : String(days));
    router.replace(`${pathname}?${sp.toString()}`);
  }

  function setAssigneeParam(value: string | null) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value) sp.set(ASSIGNEE_SUB_ATTR, value);
    else sp.delete(ASSIGNEE_SUB_ATTR);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // ---- the lane queries (startsim-wn2p.27) ----
  //
  // Every filter this page offers is expressible as a backend predicate, so ALL
  // of them go into the lane queries. There is no client-side filtering pass
  // left: what a lane returns is what a lane shows, and its `count` is the true
  // size of that lane under exactly these filters.
  const statusAttr = useMemo(() => pickStatusAttr(type), [type]);
  const columns = useMemo(() => boardColumns(statusAttr), [statusAttr]);

  const baseFilters = useMemo(() => {
    const facets = facetFilters(filters, assigneeFilter);
    // A BLANK assignee facet ("unassigned") has no backend predicate — see
    // facetFilters. Rather than quietly drop it and show everyone's work, the
    // page keeps the board unfiltered and says so in the header chip.
    return { ...recencyQuery, ...(facets ?? {}) };
  }, [recencyQuery, filters, assigneeFilter]);

  /** How many pages each lane has asked for. Scrolling one lane bumps one entry. */
  const [pages, setPages] = useState<LanePages>({});
  // A filter change makes every lane a different question, so the page counts
  // reset with it — otherwise a lane scrolled deep under one window would fetch
  // four pages of a window that has three.
  const filterKey = JSON.stringify(baseFilters);
  const [pagesFor, setPagesFor] = useState(filterKey);
  if (pagesFor !== filterKey) {
    setPagesFor(filterKey);
    setPages({});
  }

  const laneKey = useCallback(
    (laneId: string) => ['entities', typeKey, 'lane', laneId, baseFilters, lanePages(pages, laneId)] as const,
    [typeKey, baseFilters, pages],
  );

  const statusName = statusAttr?.name ?? '';
  const laneQueries = useQueries({
    queries: columns.map((col) => {
      const lf = statusName ? laneFilters(statusName, col.id, baseFilters) : null;
      return {
        queryKey: laneKey(col.id),
        queryFn: () => fetchEntityPages(typeKey, lf ?? undefined, lanePages(pages, col.id), LANE_PAGE_SIZE),
        // The type must resolve first: its declared enum is what the lanes ARE,
        // and its declared date attribute is what the window filters on. The
        // Unset lane has no query at all — see lib/lanes.ts.
        enabled: !typesQuery.isLoading && lf != null,
      };
    }),
  });

  const lanes = useMemo(() => {
    const out: Record<string, LaneState> = {};
    columns.forEach((col, i) => {
      const q = laneQueries[i];
      const slice = q?.data as EntityPageSlice | undefined;
      out[col.id] = {
        records: slice?.records ?? [],
        count: slice?.count ?? 0,
        hasMore: slice?.hasMore ?? false,
        loading: Boolean(q?.isFetching),
      };
    });
    return out;
  }, [columns, laneQueries]);

  const loadMore = useCallback((laneId: string) => {
    setPages((prev) => withOneMorePage(prev, laneId));
  }, []);

  const loadedCount = useMemo(
    () => Object.values(lanes).reduce((sum, l) => sum + l.records.length, 0),
    [lanes],
  );
  const laneCounts = useMemo(
    () => columns.filter((c) => c.id !== UNSET_COLUMN.id).map((c) => lanes[c.id]?.count ?? 0),
    [columns, lanes],
  );
  const lanesSettled = laneQueries.every((q) => !q.isLoading);

  /**
   * The whole board's size under the current filters, and the Unset residual.
   *
   * The lane counts already say how many records exist per lane, so `matching`
   * is only needed for one thing the lanes cannot answer: how many records carry
   * a status NO lane names. No filter can select those (see lib/lanes.ts), so
   * they are found by subtraction — and a residual that can be computed is a
   * residual that can never be silently zero.
   */
  const totalQuery = useQuery({
    queryKey: ['entities', typeKey, 'count', baseFilters],
    queryFn: () => countEntities(typeKey, baseFilters),
    enabled: !typesQuery.isLoading,
  });
  const matching = totalQuery.data ?? null;
  const unaccounted = lanesSettled ? unaccountedFor(matching, laneCounts) : 0;
  const notShown = matching == null ? 0 : Math.max(0, matching - loadedCount - unaccounted);

  const [selected, setSelected] = useState<EntityRecord | null>(null);
  const activeContentType = filters.find((f) => f.name === CONTENT_TYPE_ATTR)?.value ?? null;

  // Draft-progress rollup (startsim-4w76/n7s8) — topic board only, and only
  // fetched there: every OTHER type's board is completely unaffected.
  const isTopicBoard = typeKey === CONTENT_TYPE_KEY;
  const draftsQuery = useQuery({
    queryKey: ['entities', DRAFT_TYPE, 'all'],
    queryFn: () => listAllEntities(DRAFT_TYPE),
    enabled: isTopicBoard,
  });
  const relationshipsQuery = useQuery({
    queryKey: ['relationships', 'all'],
    queryFn: () => listAllRelationships(),
    enabled: isTopicBoard,
  });
  /**
   * Every topic, for the rollup's draft->topic matching — an EXPLICIT fetch, not
   * the union of whatever the lanes happen to have paged in.
   *
   * The union would be complete today (59 topics across four lanes of 50) and
   * would start silently dropping chips the moment a lane passed its first page.
   * A rollup that quietly degrades with data volume is worse than one extra
   * request for 59 records, and this only runs on the topic board.
   */
  const allTopicsQuery = useQuery({
    queryKey: ['entities', CONTENT_TYPE_KEY, 'all'],
    queryFn: () => listAllEntities(CONTENT_TYPE_KEY),
    enabled: isTopicBoard,
  });
  const rollupById = useMemo(() => {
    if (!isTopicBoard) return undefined;
    const drafts = draftsQuery.data ?? [];
    const relationships = relationshipsQuery.data ?? [];
    // Match against the UNFILTERED topic set — a topic's draft-progress rollup is
    // a property of the topic itself, not of whatever filter happens to be
    // active. Using the visible set would make a card's chip depend on which
    // filter was last applied.
    const allTopics = allTopicsQuery.data ?? [];
    return rollupByParent(drafts, (d) => topicIdForDraft(d, relationships, allTopics), 'status');
  }, [isTopicBoard, draftsQuery.data, relationshipsQuery.data, allTopicsQuery.data]);
  function rollupLabel(counts: RollupCounts): string | null {
    if (counts.total === 0) return null;
    const done = counts.byStatus[DRAFT_DONE_STATUS] ?? 0;
    return `${done}/${counts.total} ${DRAFT_DONE_STATUS}`;
  }

  const loading = typesQuery.isLoading || !lanesSettled;
  const mySub = whoamiQuery.data?.sub;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {activeContentType ? contentCategoryLabel(activeContentType) : `${type?.label ?? typeKey} — Board`}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
            <span>
              {loadedCount.toLocaleString()}
              {matching != null && matching !== loadedCount ? ` of ${matching.toLocaleString()}` : ''} records
            </span>
            {filters.map((f) => (
              <span key={f.name} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                {f.name.replace(/_/g, ' ')}: {f.value}
              </span>
            ))}
            {assigneeFilter ? (
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                assignee: {assigneeFilter.value === BLANK ? 'unassigned' : assigneeFilter.value}
              </span>
            ) : null}
            {notShown > 0 ? (
              <span className="text-xs text-neutral-400">
                {notShown.toLocaleString()} more in the lanes — scroll to load
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-neutral-400">Showing</span>
            {RECENCY_WINDOWS.map((w) => (
              <button
                key={w.days ?? RECENCY_ALL}
                type="button"
                onClick={() => setRecencyParam(w.days)}
                className={`rounded border px-2 py-1 hover:bg-neutral-50 ${
                  recency.days === w.days ? 'border-primary-300 bg-primary-50 text-primary-700' : ''
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          {hasAssigneeAttr ? (
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setAssigneeParam(mySub && assigneeFilter?.value === mySub ? null : mySub ?? null)}
                disabled={!mySub}
                className={`rounded border px-2 py-1 hover:bg-neutral-50 disabled:opacity-50 ${
                  mySub && assigneeFilter?.value === mySub ? 'border-primary-300 bg-primary-50' : ''
                }`}
              >
                Assigned to me
              </button>
              <button
                type="button"
                onClick={() => setAssigneeParam(assigneeFilter?.value === BLANK ? null : BLANK)}
                className={`rounded border px-2 py-1 hover:bg-neutral-50 ${
                  assigneeFilter?.value === BLANK ? 'border-primary-300 bg-primary-50' : ''
                }`}
              >
                Unassigned
              </button>
              {assigneeFilter ? (
                <button
                  type="button"
                  onClick={() => setAssigneeParam(null)}
                  className="rounded border px-2 py-1 text-neutral-500 hover:bg-neutral-50"
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
          <Link
            href={`/t/${typeKey}`}
            className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Table view
          </Link>
        </div>
      </div>

      {isTopicBoard ? (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <Link
            href={`/board/${CONTENT_TYPE_KEY}`}
            className={`rounded-full border px-3 py-1 ${
              !activeContentType ? 'border-primary-300 bg-primary-50 text-primary-700' : 'hover:bg-neutral-50'
            }`}
          >
            All
          </Link>
          {CONTENT_CATEGORIES.map((c) => (
            <Link
              key={c.key}
              href={contentBoardHref(c.key)}
              className={`rounded-full border px-3 py-1 ${
                activeContentType === c.key ? 'border-primary-300 bg-primary-50 text-primary-700' : 'hover:bg-neutral-50'
              }`}
            >
              {c.label}
            </Link>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : !type ? (
        <p className="text-sm text-neutral-500">Unknown type “{typeKey}”.</p>
      ) : !statusAttr ? (
        <div className="rounded border p-4 text-sm text-neutral-600">
          This type has no “status” (choice) field, so there is nothing to lay out as a board.{' '}
          <Link href={`/t/${typeKey}`} className="underline">
            Open the table view
          </Link>
          .
        </div>
      ) : (
        <EntityBoard
          type={type}
          lanes={lanes}
          onLoadMore={loadMore}
          laneKey={laneKey}
          unaccounted={unaccounted}
          onCardClick={setSelected}
          rollupById={rollupById}
          rollupLabel={isTopicBoard ? rollupLabel : undefined}
        />
      )}

      {type ? (
        <EntityDetailDrawer
          type={type}
          record={selected}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            // Refetch the board AND re-point `selected` at the fresh record so the
            // open drawer reflects mutations made from inside it (e.g. Mark ready
            // moves the topic to 'written') instead of showing the stale prop.
            //
            // Invalidating the whole `['entities', typeKey]` prefix catches every
            // lane and the count, because an edit can move a record between lanes
            // and only the server knows which one it landed in. The record itself
            // is re-read by id rather than hunted for across the refreshed lanes —
            // an edit that moves it out of the loaded page of its new lane would
            // otherwise leave the open drawer showing the stale prop.
            const id = selected?.id;
            await qc.invalidateQueries({ queryKey: ['entities', typeKey] });
            if (id != null) {
              const fresh = await getEntity(id).catch(() => null);
              if (fresh) setSelected(fresh);
            }
          }}
        />
      ) : null}
    </div>
  );
}
