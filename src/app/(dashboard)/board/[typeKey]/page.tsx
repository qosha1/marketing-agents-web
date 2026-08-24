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
 */
import { useMemo, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { EntityBoard } from '@/components/entity-board';
import { EntityDetailDrawer } from '@/components/entity-detail-drawer';
import {
  applyAttrFilters,
  applyRecencyWindow,
  applyTextAttrFilter,
  BLANK,
  pickAttrFilters,
  pickRecencyAttr,
  pickRecencyWindow,
  pickStatusAttr,
  pickTextAttrFilter,
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
  listAllEntities,
  listTypes,
  whoami,
  type EntityRecord,
} from '@/lib/foundry-api';

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
  const serverNarrowed = Object.keys(recencyQuery).length > 0;

  // The filters are part of the fetch's identity: widening the window is a
  // different fetch, not a re-render of the same one. One value, used by both
  // the query and EntityBoard's optimistic move, so they cannot drift apart.
  const recordsKey = useMemo(
    () => ['entities', typeKey, 'all', recencyQuery],
    [typeKey, recencyQuery],
  );

  const recordsQuery = useQuery({
    queryKey: recordsKey,
    queryFn: () => listAllEntities(typeKey, { filters: recencyQuery }),
    // The type has to load first — pickRecencyAttr reads its declared attributes,
    // and fetching before it resolves would fetch the whole type unnarrowed.
    enabled: !typesQuery.isLoading,
  });

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

  const records = useMemo(() => {
    const enumFiltered = applyAttrFilters(recordsQuery.data ?? [], filters);
    const assigned = applyTextAttrFilter(enumFiltered, assigneeFilter);
    // Only when the fetch was NOT already narrowed — re-running the window over
    // server-filtered rows would apply the client's blank-date fallback to a set
    // the server had already decided, and the two disagree by design.
    return serverNarrowed ? assigned : applyRecencyWindow(assigned, recency, recencyAttr);
  }, [recordsQuery.data, filters, assigneeFilter, recency, recencyAttr, serverNarrowed]);

  /**
   * How many records of this type the board is NOT showing.
   *
   * A COUNT query rather than arithmetic on what we fetched, because the whole
   * point is that we deliberately never fetched them. It runs unconditionally,
   * not only while a window is active, because there is a SECOND way to be
   * short: listAllEntities' page cap. Either way the honest line is the same —
   * "the type holds this many more than you can see" — and a board that silently
   * shows a subset while implying it is the whole type is the defect this issue
   * started from.
   */
  // The count is taken over the SAME facets the board is showing, minus the
  // window — otherwise `?status=surfaced` (31 records) would report the other
  // 4,085 as "older", which they mostly are not. `null` means the facet cannot
  // be expressed as a count, so no number is claimed at all.
  const countFilters = useMemo(
    () => facetFilters(filters, assigneeFilter),
    [filters, assigneeFilter],
  );
  const totalQuery = useQuery({
    queryKey: ['entities', typeKey, 'count', countFilters],
    queryFn: () => countEntities(typeKey, countFilters ?? undefined),
    enabled: countFilters != null,
  });
  const notShown =
    totalQuery.data == null ? 0 : Math.max(0, totalQuery.data - records.length);

  const [selected, setSelected] = useState<EntityRecord | null>(null);
  const statusAttr = useMemo(() => pickStatusAttr(type), [type]);
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
  const rollupById = useMemo(() => {
    if (!isTopicBoard) return undefined;
    const drafts = draftsQuery.data ?? [];
    const relationships = relationshipsQuery.data ?? [];
    // Match against the UNFILTERED topic set, not the currently-visible
    // `records` — a topic's draft-progress rollup is a property of the topic
    // itself, not of whatever filter happens to be active. Using the filtered
    // list would make a card's chip depend on which filter was last applied.
    const allTopics = recordsQuery.data ?? [];
    return rollupByParent(drafts, (d) => topicIdForDraft(d, relationships, allTopics), 'status');
  }, [isTopicBoard, draftsQuery.data, relationshipsQuery.data, recordsQuery.data]);
  function rollupLabel(counts: RollupCounts): string | null {
    if (counts.total === 0) return null;
    const done = counts.byStatus[DRAFT_DONE_STATUS] ?? 0;
    return `${done}/${counts.total} ${DRAFT_DONE_STATUS}`;
  }

  const loading = typesQuery.isLoading || recordsQuery.isLoading;
  const mySub = whoamiQuery.data?.sub;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {activeContentType ? contentCategoryLabel(activeContentType) : `${type?.label ?? typeKey} — Board`}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
            <span>{records.length} records</span>
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
                {notShown.toLocaleString()} {recency.days == null ? 'not loaded' : 'older not shown'}
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
          records={records}
          queryKey={recordsKey}
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
            const res = await recordsQuery.refetch();
            setSelected((cur) => (cur ? (res.data?.find((r) => r.id === cur.id) ?? cur) : cur));
          }}
        />
      ) : null}
    </div>
  );
}
