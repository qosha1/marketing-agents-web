'use client';

/**
 * Research > Topics (bd startsim-lbpto): Topic, Sources, Markets, Dates, In Content
 * and nothing else. Search, a Market menu and the range chips are the wireframe's
 * toolbar; narrowing, sorting and paging are all asked of the server.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { UnifiedTable, type ColumnConfig } from '@startsimpli/ui';

import { ResearchToolbar } from '@/components/research/list-toolbar';
import { ResearchHead, plural } from '@/components/research/page-head';
import { readData } from '@/lib/board';
import { listEntities, type EntityRecord } from '@/lib/foundry-api';
import { TOPIC_DEFAULT_RANGE, TOPIC_RANGES, topicFilters } from '@/lib/research/filters';
import { countDraftsByTopic, topicRow, topicSourceUrls, type TopicRow } from '@/lib/research/topics';
import { tablePaging, tableSorting, useResearchList } from '@/lib/research/use-list';

const cols = (): ColumnConfig<TopicRow>[] => [
  {
    id: 'title',
    header: 'Topic',
    sortable: true,
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-neutral-900">{r.title}</div>
        {r.angle ? <div className="truncate text-xs text-neutral-500">{r.angle}</div> : null}
      </div>
    ),
  },
  {
    id: 'sources',
    header: 'Sources',
    sortable: false, // a count of cited addresses: the tenant has nothing to sort it on
    width: 96,
    cell: (r) => (
      <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full bg-slate-100 px-2 text-xs text-slate-700">
        {plural(r.sources, 'source')}
      </span>
    ),
  },
  { id: 'markets', header: 'Markets', sortable: true, width: 156, cell: (r) => r.markets || '—' },
  { id: 'dates', header: 'Dates', sortable: true, width: 156, cell: (r) => <span className="whitespace-nowrap">{r.dates || '—'}</span> },
  {
    id: 'inContent',
    header: 'In Content',
    sortable: false, // counted from the drafts of this page of topics, not a stored value
    width: 150,
    cell: (r) =>
      r.inContent ? (
        <span className="whitespace-nowrap text-indigo-700">{`${plural(r.inContent, 'item')} in Content`}</span>
      ) : (
        <span className="text-neutral-400">None yet</span>
      ),
  },
];

const str = (v: unknown) => (v == null ? '' : String(v));

export default function ResearchTopicsPage() {
  const router = useRouter();
  const [market, setMarket] = useState('');
  const [range, setRange] = useState(TOPIC_DEFAULT_RANGE);
  const list = useResearchList('topic', ({ search, sort }) => topicFilters({ search, sort, market, range }), [market, range]);
  const ids = list.rows.map((t) => String(t.id));
  const urls = list.rows.flatMap(topicSourceUrls);

  // The markets to offer, and how many documents the topics in range are made of.
  const facets = useQuery({
    queryKey: ['research', 'topic-facets', range],
    queryFn: () => listEntities('topic', 1, { ...topicFilters({ range }), page_size: '200' }),
  });
  const markets = useMemo(
    () =>
      [
        ...new Set(
          (facets.data?.results ?? [])
            .flatMap((t) => str(readData(t.data, 'market')).split(',').map((m) => m.trim()))
            .filter(Boolean),
        ),
      ].sort(),
    [facets.data],
  );
  const documents =
    facets.data && facets.data.count <= facets.data.results.length
      ? facets.data.results.reduce((n, t) => n + topicSourceUrls(t).length, 0)
      : null;

  // One query for the drafts of THIS page of topics, not a scan of every draft.
  const drafts = useQuery({
    queryKey: ['research', 'topic-drafts', ids],
    enabled: ids.length > 0,
    queryFn: () => listEntities('draft', 1, { 'attr.topic_ref__in': ids.join(','), page_size: '200' }),
  });
  // And one for the documents behind them, which is where "Dates" comes from.
  const docs = useQuery({
    queryKey: ['research', 'topic-page-docs', urls],
    enabled: urls.length > 0,
    queryFn: () => listEntities('news_item', 1, { 'attr.url__in': urls.join(','), page_size: '200' }),
  });

  const rows = useMemo(() => {
    const counts = countDraftsByTopic(drafts.data?.results ?? []);
    const byUrl: Record<string, EntityRecord> = {};
    for (const d of docs.data?.results ?? []) byUrl[str(readData(d.data, 'url'))] = d;
    return list.rows.map((t) => topicRow(t, counts[String(t.id)] ?? 0, byUrl));
  }, [list.rows, drafts.data, docs.data]);

  const narrowed = list.filtersApplied || Boolean(market) || range !== TOPIC_DEFAULT_RANGE;
  const clearFilters = () => {
    setMarket('');
    setRange('all');
    list.setSearch('');
    list.setPage(1);
  };

  return (
    <div className="space-y-4">
      <ResearchHead
        title="Topics"
        meta={`${plural(list.total, 'topic')}${
          documents != null && list.total > 0 && !list.filtersApplied && !market ? ` from ${plural(documents, 'document')}` : ''
        }`}
      />
      <ResearchToolbar
        search={list.search}
        onSearch={list.setSearch}
        placeholder="Search topics…"
        menus={[
          {
            id: 'Market',
            value: market,
            onChange: (v) => {
              setMarket(v);
              list.setPage(1);
            },
            options: [{ value: '', label: 'Market: All' }, ...markets.map((m) => ({ value: m, label: `Market: ${m}` }))],
          },
        ]}
        chips={{
          label: 'Showing',
          value: range,
          options: TOPIC_RANGES,
          onChange: (v) => {
            setRange(v);
            list.setPage(1);
          },
        }}
      />
      <UnifiedTable<TopicRow>
        tableId="research-topics"
        data={rows}
        columns={cols()}
        getRowId={(r) => r.id}
        loading={list.loading}
        onRowClick={(r) => router.push(`/research/topics/${r.id}`)}
        pagination={tablePaging(list)}
        sorting={tableSorting(list)}
        emptyState={
          narrowed ? (
            <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-neutral-600">
              No topics match these filters.{' '}
              <button type="button" className="text-indigo-700 underline" onClick={clearFilters}>
                Clear filters
              </button>
            </p>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center">
              <p className="text-sm font-medium text-neutral-900">No topics yet</p>
              <p className="text-sm text-neutral-500">Topics appear here as documents are collected from your sources.</p>
            </div>
          )
        }
      />
    </div>
  );
}
