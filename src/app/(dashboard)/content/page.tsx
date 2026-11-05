'use client';

/**
 * Content (v2, bd startsim-8vm6a): the approved work. Title, Market, Assigned,
 * Status, Scheduled. Rejected items are never listed. One header, one table;
 * search, status filter, sort and paging all go to the server.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, UnifiedTable, type FiltersConfig } from '@startsimpli/ui';

import { choicesOf } from '@/lib/board';
import {
  CONTENT_COLUMNS,
  CONTENT_PAGE_SIZE,
  contentListFilters,
  contentRow,
  type ContentRow,
} from '@/lib/content-list';
import { fetchContentPage, fetchTopicMarkets } from '@/lib/content-queries';
import { CONTENT_STATUS_KEYS, contentStatusLabel, type ContentStatus } from '@/lib/content-status';
import { listTypes } from '@/lib/foundry-api';
import { getActiveProjectId } from '@/lib/project-scope';

const TONE: Record<ContentStatus, string> = {
  draft: 'bg-neutral-100 text-neutral-600',
  approved: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-emerald-100 text-emerald-700',
  posted: 'bg-sky-100 text-sky-700',
};

const SORTABLE = new Set(['assigned', 'status', 'scheduled']);

export default function ContentPage() {
  const router = useRouter();
  // Read on every render and part of the query key, so a switch re-queries.
  const projectId = getActiveProjectId();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContentStatus | null>(null);
  const [sort, setSort] = useState<{ sortBy: string | null; sortDirection: 'asc' | 'desc' }>({ sortBy: null, sortDirection: 'asc' });
  const [page, setPage] = useState(1);

  const types = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });
  const draftType = (types.data?.results ?? []).find((t) => t.key === 'draft');
  const declared = useMemo(
    () => choicesOf(draftType?.attributes?.find((a) => a.name === 'status') ?? null),
    [draftType],
  );

  const filters = contentListFilters({
    search, status, sortBy: sort.sortBy, sortDirection: sort.sortDirection, page, declaredStatuses: declared, projectId,
  });
  const list = useQuery({
    queryKey: ['content-list', projectId, filters, page],
    queryFn: async () => {
      const res = await fetchContentPage(filters, page);
      return { res, topics: await fetchTopicMarkets(res.results ?? []) };
    },
    enabled: !!draftType,
    placeholderData: (prev) => prev,
  });

  const rows: ContentRow[] = useMemo(
    () => (list.data?.res.results ?? []).map((r) => contentRow(r, list.data?.topics ?? {})),
    [list.data],
  );
  const total = list.data?.res.count ?? 0;

  const columns = CONTENT_COLUMNS.map((c) => ({
    id: c.id,
    header: c.label,
    sortable: SORTABLE.has(c.id),
    cell: (row: ContentRow) =>
      c.id === 'status' ? (
        row.status ? (
          <span className={`rounded-full px-2.5 py-0.5 text-xs ${TONE[row.status]}`}>{row.statusLabel}</span>
        ) : null
      ) : (
        <span className={c.id === 'title' ? 'font-medium' : 'text-neutral-600'}>{row[c.id] || ''}</span>
      ),
  }));

  const filtersConfig: FiltersConfig = {
    enabled: true,
    position: 'top',
    collapsible: false,
    defaultExpanded: true,
    config: {
      sections: [
        {
          id: 'status',
          type: 'chips',
          filters: [
            {
              id: 'status',
              label: 'Status',
              options: CONTENT_STATUS_KEYS,
              optionLabels: Object.fromEntries(CONTENT_STATUS_KEYS.map((k) => [k, contentStatusLabel(k)])),
            },
          ],
        },
      ],
    },
    value: status ? { status } : {},
    onChange: (fs) => {
      const v = fs.status ? String(fs.status) : null;
      setStatus(CONTENT_STATUS_KEYS.includes(v as ContentStatus) ? (v as ContentStatus) : null);
      setPage(1);
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content</h1>
          <p className="text-sm text-neutral-500">
            {total} item{total === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/content/calendar" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-neutral-50">
            Calendar
          </Link>
          <Button asChild>
            <Link href="/content/new">
              <Plus className="mr-1 h-4 w-4" /> Add content
            </Link>
          </Button>
        </div>
      </div>

      <UnifiedTable<ContentRow>
        tableId="content-v2"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        loading={list.isLoading}
        onRowClick={(r) => router.push(`/content/${r.id}`)}
        search={{
          enabled: true,
          placeholder: 'Search content…',
          value: search,
          onChange: (v) => {
            setSearch(v);
            setPage(1);
          },
          debounceMs: 300,
          preserveFocus: true,
        }}
        filters={filtersConfig}
        sorting={{
          enabled: true,
          serverSide: true,
          value: sort,
          onChange: (s) => {
            setSort(s);
            setPage(1);
          },
        }}
        pagination={{
          enabled: total > 0,
          serverSide: true,
          pageSize: CONTENT_PAGE_SIZE,
          totalCount: total,
          currentPage: page,
          onPageChange: setPage,
        }}
        emptyState={
          <div data-testid="content-empty" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-gray-500">
            {search.trim() || status ? (
              'No content matches.'
            ) : (
              <>
                <p className="font-medium text-gray-700">No content yet</p>
                <p>Start one from a topic, or add it yourself.</p>
                <Link href="/content/new" className="mt-3 inline-block rounded-md border border-border px-3 py-2 text-sm text-gray-700 hover:bg-neutral-50">
                  Add content
                </Link>
              </>
            )}
          </div>
        }
      />
    </div>
  );
}
