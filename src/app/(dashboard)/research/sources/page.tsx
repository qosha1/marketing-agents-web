'use client';

/**
 * Research > Sources: the documents pulled in (bd startsim-wgmf5). Document,
 * Source, Published, Review; search, source / review / date filters and sort all
 * run on the server. No page actions; Good / Not good are row actions.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UnifiedTable, notify, type ColumnConfig } from '@startsimpli/ui';

import { ResearchToolbar } from '@/components/research/list-toolbar';
import { ResearchHead, plural } from '@/components/research/page-head';
import { readData } from '@/lib/board';
import { listEntities, listTypes, updateEntity, type EntityRecord, type EntityTypeDef } from '@/lib/foundry-api';
import { documentFilters, type DocumentQuery } from '@/lib/research/filters';
import { documentReview, REVIEW_LABEL, reviewDocumentData, type ReviewChoice } from '@/lib/research/review';
import { documentLine, formatDay } from '@/lib/research/topics';
import { tablePaging, tableSorting, useResearchList } from '@/lib/research/use-list';

const str = (v: unknown) => (v == null ? '' : String(v));

export default function ResearchSourcesPage() {
  const qc = useQueryClient();
  const [source, setSource] = useState('');
  const [review, setReview] = useState<NonNullable<DocumentQuery['review']>>('all');
  const [range, setRange] = useState<NonNullable<DocumentQuery['range']>>('all');

  const list = useResearchList(
    'news_item',
    ({ search, sort }) => documentFilters({ search, sort, source, review, range }),
    [source, review, range],
  );
  const typesQuery = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });
  const newsType = typesQuery.data?.results.find((t) => t.key === 'news_item') ?? null;
  const sourcesQuery = useQuery({ queryKey: ['research', 'source-names'], queryFn: () => listEntities('source', 1, { page_size: '200' }) });

  const decide = useMutation({
    mutationFn: async ({ doc, choice }: { doc: EntityRecord; choice: ReviewChoice }) => {
      const data = reviewDocumentData(doc, choice, newsType);
      if (!data) throw new Error('This type has no Good / Not good status.');
      return updateEntity(doc.id, { data });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research', 'news_item'] }),
    onError: (err) => notify.error(err instanceof Error ? err.message : 'Could not save the review.'),
  });

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    list.setPage(1);
  };

  const columns: ColumnConfig<EntityRecord>[] = [
    {
      id: 'title',
      header: 'Document',
      sortable: true,
      cell: (d) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-neutral-900">{str(readData(d.data, 'title')) || d.name}</div>
          <div className="truncate text-xs text-neutral-500">{documentLine(d)}</div>
        </div>
      ),
    },
    { id: 'source', header: 'Source', sortable: true, width: 190, cell: (d) => str(readData(d.data, 'source_name')) || str(readData(d.data, 'domain')) || '—' },
    { id: 'published', header: 'Published', sortable: true, width: 120, cell: (d) => formatDay(str(readData(d.data, 'published_at'))) || '—' },
    {
      id: 'review',
      header: 'Review',
      sortable: true,
      width: 250,
      cell: (d) => <ReviewCell doc={d} type={newsType} onChoose={(choice) => decide.mutate({ doc: d, choice })} />,
    },
  ];

  const anyFilter = list.filtersApplied || Boolean(source) || review !== 'all' || range !== 'all';

  return (
    <div className="space-y-4">
      <ResearchHead title="Sources" count={plural(list.total, 'document')} />
      <ResearchToolbar
        search={list.search}
        onSearch={list.setSearch}
        placeholder="Search documents…"
        menus={[
          {
            id: 'Source',
            value: source,
            onChange: resetPage(setSource),
            options: [
              { value: '', label: 'Source' },
              ...(sourcesQuery.data?.results ?? []).map((s) => ({ value: s.name, label: s.name })),
            ],
          },
          {
            id: 'Review',
            value: review,
            onChange: (v) => resetPage(setReview)(v as typeof review),
            options: [
              { value: 'all', label: 'Review' },
              { value: 'good', label: REVIEW_LABEL.good },
              { value: 'not_good', label: REVIEW_LABEL.not_good },
              { value: 'unreviewed', label: REVIEW_LABEL.unreviewed },
            ],
          },
          {
            id: 'Date',
            value: range,
            onChange: (v) => resetPage(setRange)(v as typeof range),
            options: [
              { value: 'all', label: 'Date' },
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
            ],
          },
        ]}
      />
      <UnifiedTable<EntityRecord>
        tableId="research-sources"
        data={list.rows}
        columns={columns}
        getRowId={(d) => String(d.id)}
        loading={list.loading}
        pagination={tablePaging(list)}
        sorting={tableSorting(list)}
        emptyState={
          anyFilter ? (
            <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-neutral-600">No documents match.</p>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center">
              <p className="text-sm font-medium text-neutral-900">No documents yet</p>
              <p className="text-sm text-neutral-500">Documents appear here once sources are set up in Settings.</p>
            </div>
          )
        }
      />
    </div>
  );
}

function ReviewCell({ doc, type, onChoose }: { doc: EntityRecord; type: EntityTypeDef | null; onChoose: (c: ReviewChoice) => void }) {
  const current = documentReview(doc, type);
  const btn = (choice: ReviewChoice, label: string, on: boolean) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        onChoose(choice);
      }}
      className={`h-[26px] whitespace-nowrap rounded-md border px-2.5 text-xs font-medium ${
        on
          ? choice === 'good'
            ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
            : 'border-red-300 bg-red-50 text-red-700'
          : 'border-border bg-white text-neutral-700 hover:bg-neutral-50'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1.5">
      {btn('good', REVIEW_LABEL.good, current === 'good')}
      {btn('not_good', REVIEW_LABEL.not_good, current === 'not_good')}
      {current === 'unreviewed' ? <span className="whitespace-nowrap text-xs text-neutral-400">{REVIEW_LABEL.unreviewed}</span> : null}
    </div>
  );
}
