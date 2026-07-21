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
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { UnifiedTable, Button, BaseDialog, type FiltersConfig } from '@startsimpli/ui';
import { ReviewDrawer } from '@startsimpli/ui/collection';
import { listTypes, listEntities, listAllEntities, collectionClient, type EntityRecord } from '@/lib/foundry-api';
import { RecordForm } from '@/components/record-form';
import { buildRecordColumns } from '@/components/record-columns';
import { EntityDetailDrawer, RecordEditFields, TopicDrafts } from '@/components/entity-detail-drawer';
import { choicesOf, pickStatusAttr, readData } from '@/lib/board';
import { CONTENT_CATEGORIES, CONTENT_TYPE_ATTR, CONTENT_TYPE_KEY, contentCategoryLabel } from '@/lib/content';

const PAGE_SIZE = 20; // matches DRF PageNumberPagination's default page size
const DRAFT_TYPE_KEY = 'draft';
const STATUS_ATTR = 'status';

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

  // Sort is client-side over the full (bounded) set — the backend can't ORDER BY a
  // data-blob field. So a sort, like a filter, switches the table to fetch-all;
  // the default (unsorted, unfiltered) view stays server-paginated & cheap.
  const [sort, setSort] = useState<{ sortBy?: string | null; sortDirection?: 'asc' | 'desc' }>({});
  const anySort = !!sort.sortBy;
  const needAll = anyFilter || anySort;

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
    queryKey: ['entities', typeKey, 'all'],
    queryFn: () => listAllEntities(typeKey),
    enabled: !!type && needAll,
  });

  const filteredRecords = useMemo(() => {
    const rows = allQuery.data ?? [];
    return rows.filter((r) =>
      Object.entries(filterState).every(
        ([k, v]) => String(readData(r.data, k) ?? '') === v,
      ),
    );
  }, [allQuery.data, filterState]);

  // The content spine (topic) shows a stacked Title + subtitle (the split-off
  // `subtitle`, else `angle`) as its primary column and folds the now-redundant
  // title/subtitle/angle columns into it — killing the old Name==Title dup.
  const isContent = typeKey === CONTENT_TYPE_KEY;
  const columns = useMemo(
    () =>
      buildRecordColumns(
        type?.attributes ?? [],
        isContent ? { subtitleAttrs: ['subtitle', 'angle'], hide: ['title', 'subtitle', 'angle'] } : {},
      ),
    [type?.attributes, isContent],
  );

  const hasStatusBoard = !!statusAttr;

  // Default-visible columns: Name + the content-defining fields (Kind, State,
  // Judge, …) first, then the next few short attrs, then Created. Long body/blob
  // fields (blog, linkedin, seo, sources, …) are NEVER default-visible — a table
  // is for scanning, not reading a 500-word article; those live on the detail
  // page and stay one toggle away in the Columns menu. persistKey is bumped so a
  // previously-saved column choice that surfaced body fields is reset.
  const columnVisibility = useMemo(() => {
    const LONG_FIELDS = new Set([
      'blog', 'linkedin', 'seo', 'sources', 'body', 'content', 'auto_checks', '_origin', '_sample',
      // On the content spine these are folded into the stacked Title column.
      ...(isContent ? ['title', 'subtitle', 'angle'] : []),
    ]);
    const attrIds = (type?.attributes ?? []).map((a) => a.name).filter((n) => !LONG_FIELDS.has(n));
    const preferred = ['content_type', 'status', 'judge_verdict', 'candidate_index', 'story_title', 'sent_at', 'market'].filter(
      (p) => attrIds.includes(p),
    );
    const rest = attrIds.filter((a) => !preferred.includes(a));
    const visibleAttrs = [...preferred, ...rest].slice(0, 5);
    return {
      enabled: true,
      alwaysVisible: ['name'],
      defaultVisible: ['name', ...visibleAttrs, 'createdAt'],
      persistKey: `records-${typeKey}-v2`,
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

  const records = needAll ? filteredRecords : (pagedQuery.data?.results ?? []);
  const totalCount = needAll ? filteredRecords.length : (pagedQuery.data?.count ?? 0);
  const recordsLoading = needAll ? allQuery.isLoading : pagedQuery.isLoading;
  const activeKind = filterState[CONTENT_TYPE_ATTR];

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

      <UnifiedTable<EntityRecord>
        key={`records-${typeKey}-${JSON.stringify(filterState)}`}
        tableId={`records-${typeKey}`}
        data={records}
        columns={columns}
        getRowId={(row) => String(row.id)}
        loading={recordsLoading}
        onRowClick={handleRowClick}
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
          totalCount,
          currentPage: page,
          onPageChange: setPage,
        }}
      />

      {typeKey === CONTENT_TYPE_KEY ? (
        // Topic = the editorial spine → the fast review-first drawer (verdict /
        // approve / reject / note, ↑↓/j-k to the next, deep field-edit behind
        // "Edit fields"). Walks the currently-visible list for prev/next.
        <ReviewDrawer
          client={collectionClient}
          type={type}
          records={records}
          record={selected}
          onClose={() => setSelected(null)}
          onNavigate={setSelected}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['entities', typeKey] });
          }}
          renderEditFields={({ record: r, type: t, back, saved }) => (
            <RecordEditFields type={t} record={r} onSaved={saved} onCancel={back} />
          )}
          renderExtra={(r) => <TopicDrafts topic={r} />}
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
