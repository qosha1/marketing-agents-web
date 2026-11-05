'use client';

/**
 * Research > Sources: the documents pulled in (bd startsim-wgmf5). Document,
 * Source, Published, Review; search, source / review / date filters and sort all
 * run on the server. No page actions; Good / Not good are row actions.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UnifiedTable, notify, type ColumnConfig } from '@startsimpli/ui';

import { ResearchHead, plural } from '@/components/research/page-head';
import { readData } from '@/lib/board';
import { listEntities, listTypes, updateEntity, type EntityRecord, type EntityTypeDef } from '@/lib/foundry-api';
import { documentFilters, type DocumentQuery } from '@/lib/research/filters';
import { documentReview, REVIEW_LABEL, reviewDocumentData, type ReviewChoice } from '@/lib/research/review';
import { documentLine, formatDay } from '@/lib/research/topics';
import { tablePaging, tableSorting, useResearchList } from '@/lib/research/use-list';

const str = (v: unknown) => (v == null ? '' : String(v));

const selectClass = 'h-9 rounded-md border border-border bg-background px-2 text-sm text-neutral-800';

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
      width: 230,
      cell: (d) => <ReviewCell doc={d} type={newsType} onChoose={(choice) => decide.mutate({ doc: d, choice })} />,
    },
  ];

  const anyFilter = list.filtersApplied || Boolean(source) || review !== 'all' || range !== 'all';

  return (
    <div className="space-y-4">
      <ResearchHead title="Sources" sub={plural(list.total, 'document')} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="f-source">Source</label>
        <select id="f-source" aria-label="Source" className={selectClass} value={source} onChange={(e) => resetPage(setSource)(e.target.value)}>
          <option value="">Source: all</option>
          {(sourcesQuery.data?.results ?? []).map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="f-review">Review</label>
        <select id="f-review" aria-label="Review" className={selectClass} value={review} onChange={(e) => resetPage(setReview)(e.target.value as typeof review)}>
          <option value="all">Review: all</option>
          <option value="good">{REVIEW_LABEL.good}</option>
          <option value="not_good">{REVIEW_LABEL.not_good}</option>
          <option value="unreviewed">{REVIEW_LABEL.unreviewed}</option>
        </select>
        <label className="sr-only" htmlFor="f-date">Date</label>
        <select id="f-date" aria-label="Date" className={selectClass} value={range} onChange={(e) => resetPage(setRange)(e.target.value as typeof range)}>
          <option value="all">Date: any time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>
      <UnifiedTable<EntityRecord>
        tableId="research-sources"
        data={list.rows}
        columns={columns}
        getRowId={(d) => String(d.id)}
        loading={list.loading}
        search={{ enabled: true, placeholder: 'Search documents…', value: list.search, onChange: list.setSearch, debounceMs: 300, preserveFocus: true }}
        pagination={tablePaging(list)}
        sorting={tableSorting(list)}
        emptyState={
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-neutral-500">
            {anyFilter ? 'No documents match.' : 'No documents yet. Documents appear here once sources are set up in Settings.'}
          </p>
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
      className={`rounded-md border px-2 py-1 text-xs ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-border text-neutral-700 hover:bg-neutral-50'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      {btn('good', REVIEW_LABEL.good, current === 'good')}
      {btn('not_good', REVIEW_LABEL.not_good, current === 'not_good')}
      {current === 'unreviewed' ? <span className="text-xs text-neutral-400">{REVIEW_LABEL.unreviewed}</span> : null}
    </div>
  );
}
