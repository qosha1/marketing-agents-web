'use client';

/**
 * Generic records TABLE for any entity type — the flat, clickable "data item"
 * view of every instance (bd 768w.16.11). Content is browsed here, not on a
 * kanban board: each row is a content instance, filterable by Kind (content_type)
 * and State (status), and CLICKABLE straight into review/edit:
 *   - a `draft` row  → the full-page draft editor (/draft/<id>)
 *   - any other row  → the read-first detail/edit drawer
 * The board is still one click away via the "Board view" toggle. Reusable across
 * tenants/types — nothing here is OGMC-specific beyond the shared content taxonomy.
 */
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronDown, X } from 'lucide-react';
import { UnifiedTable, Button, BaseDialog, type FiltersConfig } from '@startsimpli/ui';
import { ReviewDrawer, InlineReviewActions, type ReviewConfig } from '@startsimpli/ui/collection';
import {
  listTypes,
  listEntities,
  listAllEntities,
  collectionClient,
  type EntityFilters,
  type EntityRecord,
} from '@/lib/foundry-api';
import { RecordForm } from '@/components/record-form';
import { buildRecordColumns } from '@/components/record-columns';
import {
  EntityDetailDrawer,
  GoodExampleToggle,
  RecordEditFields,
  TopicDrafts,
} from '@/components/entity-detail-drawer';
import {
  actedOn,
  choicesOf,
  defaultTopicOrder,
  holdActedPositions,
  noteActed,
  pickStatusAttr,
  pickTitleAttr,
  readData,
  readmitActed,
  searchFilters,
  type ActedRow,
} from '@/lib/board';
import {
  applyDraftsRecency,
  applyTopicGate,
  approvedTopicIds,
  clearedDraftsView,
  draftsGateNeedsClient,
  draftsViewChips,
  draftsViewFilters,
  topicGateActive,
  TOPIC_GATE_PARAM,
  APPROVED_TOPIC_STATUSES,
} from '@/lib/drafts-view';
import { CONTENT_CATEGORIES, CONTENT_TYPE_ATTR, CONTENT_TYPE_KEY, contentCategoryLabel } from '@/lib/content';
import { NEWS_ACTIONS_HEADER, TOPIC_ACTIONS_HEADER } from '@/lib/review-vocabulary';

const PAGE_SIZE = 20; // matches DRF PageNumberPagination's default page size
const DRAFT_TYPE_KEY = 'draft';
const NEWS_TYPE_KEY = 'news_item';
const STATUS_ATTR = 'status';

// News curation: a binary Accept (→acceptable, the gate before topic generation)
// / Reject (→rejected) — no verdict, no "needs work". Only `acceptable` news is
// fed to the n8n topic strategist.
const NEWS_REVIEW_CONFIG: ReviewConfig = {
  approveStatus: 'acceptable',
  rejectStatus: 'rejected',
  verdicts: [],
  omitNeedsWork: true,
};

export default function TypeRecordsPage() {
  const params = useParams<{ typeKey: string }>();
  const typeKey = params.typeKey;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<EntityRecord | null>(null);
  // Rows this session has acted on, and where they sat when it happened. The
  // reviewer's own click must never move the row out from under them
  // (startsim-azyag); the logic lives in lib/board.ts.
  const [acted, setActed] = useState<ActedRow[]>([]);
  // Title search. Deliberately LOCAL rather than in the URL: the facet value is
  // folded into the table's remount `key` below, and doing that to a
  // per-keystroke value would tear focus out of the box mid-word.
  const [search, setSearch] = useState('');
  // The ids in the order they are currently rendered. A ref, not state: it is
  // read only at the moment of a click, and making it state would re-render the
  // table on every reorder it is trying to describe.
  const rowOrderRef = useRef<EntityRecord['id'][]>([]);

  const typesQuery = useQuery({
    queryKey: ['schema-types'],
    queryFn: () => listTypes(),
  });
  const type = typesQuery.data?.results.find((t) => t.key === typeKey);

  const statusAttr = useMemo(() => pickStatusAttr(type), [type]);
  const hasContentTypeAttr = useMemo(
    () => (type?.attributes ?? []).some((a) => a.name === CONTENT_TYPE_ATTR),
    [type?.attributes],
  );

  // Facet filters (Kind = content_type, State = status), seeded from and mirrored
  // to the URL: a deep link like /t/topic?content_type=lead_magnet lands
  // pre-filtered, and a filtered view is shareable. Applied CLIENT-SIDE over the
  // bounded record set — the backend can't filter by a data-blob field.
  const filterState = useMemo<Record<string, string>>(() => {
    const fs: Record<string, string> = {};
    const kind = searchParams.get(CONTENT_TYPE_ATTR);
    const state = searchParams.get(STATUS_ATTR);
    if (kind && hasContentTypeAttr) fs[CONTENT_TYPE_ATTR] = kind;
    if (state && statusAttr) fs[STATUS_ATTR] = state;
    return fs;
  }, [searchParams, hasContentTypeAttr, statusAttr]);

  const anyFilter = Object.keys(filterState).length > 0;
  const isContent = typeKey === CONTENT_TYPE_KEY;
  const isNews = typeKey === NEWS_TYPE_KEY;
  const isDraft = typeKey === DRAFT_TYPE_KEY;

  // ---- the Drafts default view (startsim-f4lac) ----
  // ONE home for drafts, narrowed by a default the user can SEE and CLEAR — not
  // a second tab per state. lib/drafts-view.ts carries the whole rationale.
  const viewParams = useMemo(
    () => Object.fromEntries(searchParams.entries()) as Record<string, string>,
    [searchParams],
  );
  const gateOn = isDraft && topicGateActive(viewParams);
  // The approved topics, narrowed SERVER-side; the ids are then re-derived from
  // the rows that came back rather than trusted from the envelope — the same
  // defence topic-gate.ts documents.
  const approvedTopicsQuery = useQuery({
    queryKey: ['entities', CONTENT_TYPE_KEY, 'approved'],
    queryFn: () =>
      listAllEntities(CONTENT_TYPE_KEY, {
        filters: { 'attr.status__in': APPROVED_TOPIC_STATUSES.join(',') },
      }),
    enabled: gateOn,
  });
  const approvedIds = useMemo(
    () => approvedTopicIds(approvedTopicsQuery.data ?? []),
    [approvedTopicsQuery.data],
  );
  // Never fetch drafts under a gate whose id list has not arrived: that renders
  // an empty table (the `__none__` sentinel) and then flips.
  //
  // A FAILED topic fetch is not the same as a pending one. Waiting on
  // `isSuccess` alone would leave /t/draft loading forever under a chip
  // claiming "Topic approved" — an invisible filter that has stopped being a
  // filter, which is the exact failure this bead is about. So an error drops
  // the gate (never showing FEWER drafts than exist) and says so out loud.
  const gateBroken = gateOn && approvedTopicsQuery.isError;
  const gateReady = !gateOn || approvedTopicsQuery.isSuccess || approvedTopicsQuery.isError;
  const viewChips = useMemo(
    () => (isDraft ? draftsViewChips(viewParams).filter((c) => !(gateBroken && c.param === TOPIC_GATE_PARAM)) : []),
    [isDraft, viewParams, gateBroken],
  );

  // `title` on the topic spine, `story_title` on drafts — see pickTitleAttr.
  const titleAttr = useMemo(() => pickTitleAttr(type), [type]);

  // Everything the BACKEND can narrow, in the verified `attr.<name>__<op>` shape.
  const serverFilters = useMemo<EntityFilters>(
    () => ({
      ...(titleAttr ? searchFilters(search, titleAttr) : {}),
      ...(isDraft && !gateBroken ? draftsViewFilters(viewParams, approvedIds) : {}),
    }),
    [titleAttr, search, isDraft, gateBroken, viewParams, approvedIds],
  );
  const anyServerFilter = Object.keys(serverFilters).length > 0;

  // Sort is client-side over the full (bounded) set — the backend can't ORDER BY a
  // data-blob field. So a sort, like a filter, switches the table to fetch-all.
  const [sort, setSort] = useState<{ sortBy?: string | null; sortDirection?: 'asc' | 'desc' }>({});
  const anySort = !!sort.sortBy;
  // The content spine ALWAYS fetches the full (bounded) set so its default order —
  // active on top, rejected sunk to the bottom — spans every row, not just a page.
  // A server-narrowed view ALWAYS fetches its whole (bounded) result set, so the
  // "N total" below counts what MATCHED rather than the length of a page.
  // Mixing a server filter with server pagination is what makes a filtered
  // table's total lie.
  const needAll = anyFilter || anySort || isContent || isDraft || anyServerFilter;

  /** Set (or clear) view params — the default-filter chips' ✕ and "Show everything". */
  function applyViewParams(next: Record<string, string>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) sp.set(k, v);
    setPage(1);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function applyFilters(next: Record<string, unknown>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const key of [CONTENT_TYPE_ATTR, STATUS_ATTR]) {
      const v = next[key];
      if (v) sp.set(key, String(v));
      else sp.delete(key);
    }
    setPage(1);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // Unfiltered → server-paginated (the default table). Any facet active → fetch
  // the (bounded) full set once and filter + paginate client-side.
  const pagedQuery = useQuery({
    queryKey: ['entities', typeKey, page],
    queryFn: () => listEntities(typeKey, page),
    enabled: !!type && !needAll,
  });
  const allQuery = useQuery({
    queryKey: ['entities', typeKey, 'all', serverFilters],
    queryFn: () => listAllEntities(typeKey, { filters: serverFilters }),
    enabled: !!type && needAll && gateReady,
  });

  const filteredRecords = useMemo(() => {
    let rows = allQuery.data ?? [];
    if (isDraft) {
      // Cap-exceeded fallback: more approved topics than the backend's comma
      // list takes, so the gate is applied here rather than silently dropped.
      if (!gateBroken && draftsGateNeedsClient(viewParams, approvedIds)) {
        rows = applyTopicGate(rows, approvedIds);
      }
      // Recency is client-side because the backend has no filter on created_at
      // (see draftsViewFilters). The topic gate above bounds what reaches it.
      rows = applyDraftsRecency(rows, viewParams);
    }
    return rows.filter((r) =>
      Object.entries(filterState).every(
        ([k, v]) => String(readData(r.data, k) ?? '') === v,
      ),
    );
  }, [allQuery.data, filterState, isDraft, gateBroken, viewParams, approvedIds]);

  // The content spine (topic) shows a stacked Title + subtitle (the split-off
  // `subtitle`, else `angle`) as its primary column and folds the now-redundant
  // title/subtitle/angle columns into it — killing the old Name==Title dup.
  const columns = useMemo(() => {
    const attrs = type?.attributes ?? [];
    const invalidate = () => void qc.invalidateQueries({ queryKey: ['entities', typeKey] });
    // Remember WHICH row was acted on and WHERE it sat, so the refetch cannot
    // move it. `onSaved` takes no arguments, so the row is closed over here.
    const remember = (row: EntityRecord) => {
      const index = Math.max(rowOrderRef.current.indexOf(row.id), 0);
      setActed((prev) => noteActed(prev, { id: row.id, index, decision: 'decided' }));
      invalidate();
    };
    if (isContent) {
      return buildRecordColumns(attrs, {
        subtitleAttrs: ['subtitle', 'angle'],
        hide: ['title', 'subtitle', 'angle'],
        // Per-row fast triage: ✕ reject · ✓ good · ✎ edit, act-in-place (no drawer).
        // The header names WHAT is being decided — approving a topic and
        // approving a draft are different kinds of decision (startsim-b313v).
        actionsHeader: TOPIC_ACTIONS_HEADER,
        actionsCell: type
          ? (row) => (
              <div className="flex items-center justify-end gap-2">
                <JustActed acted={acted} id={row.id} />
                <InlineReviewActions
                  client={collectionClient}
                  type={type}
                  record={row}
                  onSaved={() => remember(row)}
                />
              </div>
            )
          : undefined,
      });
    }
    if (isNews) {
      // News curation: ✓ Accept (→acceptable) · ✕ Reject in place — the gate that
      // decides which articles are eligible for topic generation.
      return buildRecordColumns(attrs, {
        actionsHeader: NEWS_ACTIONS_HEADER,
        actionsCell: type
          ? (row) => (
              <div className="flex items-center justify-end gap-2">
                <JustActed acted={acted} id={row.id} />
                <InlineReviewActions
                  client={collectionClient}
                  type={type}
                  record={row}
                  config={NEWS_REVIEW_CONFIG}
                  onSaved={() => remember(row)}
                />
              </div>
            )
          : undefined,
      });
    }
    return buildRecordColumns(attrs);
  }, [type, isContent, isNews, typeKey, qc, acted]);

  const hasStatusBoard = !!statusAttr;

  // Default-visible columns: Name + the content-defining fields (Kind, State,
  // Judge, Assignee, …) first, then the next few short attrs, then Created.
  // Long body/blob fields (blog, linkedin, seo, sources, …) are NEVER
  // default-visible — a table is for scanning, not reading a 500-word
  // article; those live on the detail page and stay one toggle away in the
  // Columns menu. persistKey is bumped so a previously-saved column choice
  // (which would otherwise keep hiding a newly-preferred column) is reset.
  const columnVisibility = useMemo(() => {
    const LONG_FIELDS = new Set([
      'blog', 'linkedin', 'seo', 'sources', 'body', 'content', 'auto_checks', '_origin', '_sample',
      // On the content spine these are folded into the stacked Title column.
      ...(isContent ? ['title', 'subtitle', 'angle'] : []),
    ]);
    const attrIds = (type?.attributes ?? []).map((a) => a.name).filter((n) => !LONG_FIELDS.has(n));
    // assignee_name (startsim-71z6) is preferred so the chip actually surfaces
    // by default, the same way content_type/status/market already do — not
    // buried behind the Columns menu.
    const preferred = [
      'content_type', 'status', 'judge_verdict', 'candidate_index', 'story_title', 'sent_at', 'market', 'assignee_name',
    ].filter((p) => attrIds.includes(p));
    const rest = attrIds.filter((a) => !preferred.includes(a));
    // Cap raised 5 -> 6 so adding assignee_name to `preferred` doesn't evict an
    // existing default column (e.g. the draft table's preferred set was
    // already exactly 5 wide before this attribute existed).
    const visibleAttrs = [...preferred, ...rest].slice(0, 6);
    return {
      enabled: true,
      alwaysVisible: isContent || isNews ? ['name', '__actions'] : ['name'],
      defaultVisible: ['name', ...visibleAttrs, 'createdAt', ...(isContent || isNews ? ['__actions'] : [])],
      // v4: adds assignee_name to the preferred set (startsim-71z6).
      persistKey: `records-${typeKey}-v4`,
    };
  }, [type?.attributes, typeKey]);

  // Kind + State facet chips (shared TableFilters). Options are the raw enum
  // values; UnifiedTable renders the chips and reports changes via onChange —
  // we mirror them to the URL and apply the predicate above.
  const filtersConfig = useMemo<FiltersConfig | undefined>(() => {
    const sections: FiltersConfig['config']['sections'] = [];
    if (hasContentTypeAttr) {
      sections.push({
        id: 'kind',
        type: 'chips',
        filters: [
          { id: CONTENT_TYPE_ATTR, label: 'Kind', options: CONTENT_CATEGORIES.map((c) => c.key) },
        ],
      });
    }
    const stateChoices = choicesOf(statusAttr);
    if (stateChoices.length) {
      sections.push({
        id: 'state',
        type: 'chips',
        filters: [{ id: STATUS_ATTR, label: 'State', options: stateChoices }],
      });
    }
    if (sections.length === 0) return undefined;
    return {
      enabled: true,
      position: 'top',
      collapsible: false,
      // Show the Kind/State facet chips open on load instead of tucked behind the "Filters" toggle.
      defaultExpanded: true,
      config: { sections },
      value: filterState,
      onChange: (fs) => applyFilters(fs),
    };
    // applyFilters closes over the current searchParams/pathname, refreshed each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContentTypeAttr, statusAttr, filterState]);

  function handleRowClick(row: EntityRecord) {
    if (typeKey === DRAFT_TYPE_KEY) router.push(`/draft/${row.id}`);
    else setSelected(row);
  }

  const records = useMemo(() => {
    const base = needAll ? filteredRecords : (pagedQuery.data?.results ?? []);
    const all = needAll ? (allQuery.data ?? base) : base;
    // A row the reviewer just acted on is put back even when the active facet
    // has stopped matching it — approving under State=suggested must not make
    // the row VANISH, which reads as data loss rather than as a filter working.
    const kept = readmitActed(all, base, acted);
    // Default topic order: active on top (newest first), rejected/written sunk to
    // the bottom — so rejected topics stop reappearing. An explicit column sort
    // wins. Just-acted rows are then held at the position they were acted on, so
    // the status re-rank never moves a row out from under the person who moved it.
    if (isContent && !anySort) return holdActedPositions(kept, acted, defaultTopicOrder);
    return kept;
  }, [needAll, filteredRecords, allQuery.data, pagedQuery.data, isContent, anySort, acted]);
  const totalCount = needAll ? filteredRecords.length : (pagedQuery.data?.count ?? 0);
  const recordsLoading = needAll ? allQuery.isLoading : pagedQuery.isLoading;
  const activeKind = filterState[CONTENT_TYPE_ATTR];

  // Collapse rejected out of the main list so they stop cluttering the active
  // review — kept, not deleted, and expandable below (startsim-ay9l). Skipped
  // when the user is explicitly viewing the State=rejected filter.
  const collapseRejected = isContent && filterState[STATUS_ATTR] !== 'rejected';
  const [showRejected, setShowRejected] = useState(false);
  const { visibleRecords, rejectedRecords } = useMemo(() => {
    if (!collapseRejected) return { visibleRecords: records, rejectedRecords: [] as EntityRecord[] };
    const vis: EntityRecord[] = [];
    const rej: EntityRecord[] = [];
    for (const r of records) {
      const isRejected = String(readData(r.data, STATUS_ATTR) ?? '') === 'rejected';
      // A row you JUST rejected stays in the list, marked — collapsing it away
      // in the same breath is the disappearance this lane exists to stop.
      (isRejected && !actedOn(acted, r.id) ? rej : vis).push(r);
    }
    return { visibleRecords: vis, rejectedRecords: rej };
  }, [records, collapseRejected, acted]);

  // Read at click time by `remember` above, so an action records the position the
  // row actually held on screen.
  rowOrderRef.current = visibleRecords.map((r) => r.id);

  if (typesQuery.isLoading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  if (!type) {
    return (
      <div className="space-y-4">
        <p className="text-gray-600">
          No type called <span className="font-mono">{typeKey}</span> yet.
        </p>
        <p className="text-sm text-gray-500">
          Types are defined in the Foundry console, then appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">
          {activeKind ? contentCategoryLabel(activeKind) : type.label}
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{totalCount} total</span>
          {hasStatusBoard ? (
            <Link href={`/board/${encodeURIComponent(typeKey)}`}>
              <Button variant="outline" size="sm">
                Board view
              </Button>
            </Link>
          ) : null}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add {type.label.toLowerCase()}
          </Button>
        </div>
      </div>

      {viewChips.length > 0 || isDraft ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Showing:</span>
          {viewChips.length === 0 ? (
            <span className="text-gray-500">everything in the pipeline</span>
          ) : (
            viewChips.map((c) => (
              <button
                key={c.param}
                type="button"
                onClick={() => applyViewParams({ [c.param]: c.value })}
                className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
                title={`Remove the "${c.label}" filter`}
              >
                {c.label}
                <X className="h-3 w-3" />
              </button>
            ))
          )}
          {gateBroken ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              Could not check which topics are approved — showing drafts unfiltered
            </span>
          ) : null}
          {viewChips.length > 0 ? (
            <button
              type="button"
              onClick={() => applyViewParams(clearedDraftsView())}
              className="text-xs font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800"
            >
              Show everything
            </button>
          ) : null}
        </div>
      ) : null}

      <UnifiedTable<EntityRecord>
        key={`records-${typeKey}-${JSON.stringify(filterState)}`}
        tableId={`records-${typeKey}`}
        data={visibleRecords}
        columns={columns}
        getRowId={(row) => String(row.id)}
        loading={recordsLoading}
        onRowClick={handleRowClick}
        // The shared debounced search box (@startsimpli/ui UnifiedTable toolbar).
        // It is a CONTROLLED input and filters nothing itself, so the narrowing
        // is ours to do — and it is done server-side, in `serverFilters`.
        search={
          titleAttr
            ? {
                enabled: true,
                placeholder: `Search ${type.label.toLowerCase()} titles…`,
                value: search,
                onChange: (v) => {
                  setSearch(v);
                  setPage(1);
                },
                debounceMs: 300,
                preserveFocus: true,
              }
            : undefined
        }
        filters={filtersConfig}
        columnVisibility={columnVisibility}
        sorting={{
          // Client-side sort over whatever set is loaded; picking a sort flips
          // `needAll` on (above), so it always sorts the FULL bounded set, not
          // just the current server page.
          enabled: true,
          serverSide: false,
          value: { sortBy: sort.sortBy ?? '', sortDirection: sort.sortDirection ?? 'asc' },
          onChange: (s) => {
            setSort(s);
            setPage(1);
          },
        }}
        pagination={{
          // A sorted/filtered view holds the whole (bounded) set, so it paginates
          // client-side; the default view stays server-paginated.
          enabled: true,
          serverSide: !needAll,
          pageSize: PAGE_SIZE,
          totalCount: collapseRejected ? visibleRecords.length : totalCount,
          currentPage: page,
          onPageChange: setPage,
        }}
      />

      {collapseRejected && rejectedRecords.length > 0 ? (
        <div className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setShowRejected((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/50"
            aria-expanded={showRejected}
          >
            <span>Rejected ({rejectedRecords.length})</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showRejected ? 'rotate-180' : ''}`} />
          </button>
          {showRejected ? (
            <div className="border-t border-border">
              <UnifiedTable<EntityRecord>
                tableId={`records-${typeKey}-rejected`}
                data={rejectedRecords}
                columns={columns}
                getRowId={(row) => String(row.id)}
                onRowClick={handleRowClick}
                columnVisibility={columnVisibility}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {typeKey === CONTENT_TYPE_KEY ? (
        // Topic = the editorial spine → the fast review-first drawer (verdict /
        // approve / reject / note, ↑↓/j-k to the next, deep field-edit behind
        // "Edit fields"). Walks the currently-visible list for prev/next.
        <ReviewDrawer
          client={collectionClient}
          type={type}
          records={showRejected ? [...visibleRecords, ...rejectedRecords] : visibleRecords}
          record={selected}
          onClose={() => setSelected(null)}
          onNavigate={setSelected}
          onSaved={() => {
            // Same memory as the inline actions — a decision made in the drawer
            // must not move the row either. `onSaved` takes no arguments, so the
            // record comes from `selected`.
            const row = selected;
            if (row) {
              setActed((prev) =>
                noteActed(prev, {
                  id: row.id,
                  index: Math.max(rowOrderRef.current.indexOf(row.id), 0),
                  decision: 'decided',
                }),
              );
            }
            void qc.invalidateQueries({ queryKey: ['entities', typeKey] });
          }}
          renderEditFields={({ record: r, type: t, back, saved }) => (
            <RecordEditFields type={t} record={r} onSaved={saved} onCancel={back} />
          )}
          renderExtra={(r) => (
            <>
              <GoodExampleToggle record={r} />
              <TopicDrafts topic={r} type={type} />
            </>
          )}
        />
      ) : (
        <EntityDetailDrawer
          type={type}
          record={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['entities', typeKey] });
          }}
        />
      )}

      <BaseDialog open={addOpen} onOpenChange={setAddOpen} size="lg">
        <RecordForm
          type={type}
          onSuccess={() => setAddOpen(false)}
          onCancel={() => setAddOpen(false)}
        />
      </BaseDialog>
    </div>
  );
}

/**
 * The "you just did this" marker (bd startsim-azyag).
 *
 * Holding the row in place answers "where did it go"; this answers "which one
 * was it". Session-scoped, like the memory behind it — it marks what YOU just
 * did, not what the row's status is (the State column already says that).
 */
function JustActed({ acted, id }: { acted: ActedRow[]; id: EntityRecord['id'] }) {
  if (!actedOn(acted, id)) return null;
  return (
    <span className="whitespace-nowrap rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700">
      just updated
    </span>
  );
}
