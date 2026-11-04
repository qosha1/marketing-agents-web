'use client';

/** Research > Topics: Topic, Sources, Markets, Dates, In Content (bd startsim-lbpto). */
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { UnifiedTable, type ColumnConfig } from '@startsimpli/ui';

import { ResearchHead, plural } from '@/components/research/page-head';
import { listEntities } from '@/lib/foundry-api';
import { topicFilters, projectFilters } from '@/lib/research/filters';
import { countDraftsByTopic, topicRow, type TopicRow } from '@/lib/research/topics';
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
  { id: 'sources', header: 'Sources', width: 96, cell: (r) => plural(r.sources, 'source') },
  { id: 'markets', header: 'Markets', sortable: true, width: 156, cell: (r) => r.markets || '—' },
  { id: 'dates', header: 'Dates', width: 136, cell: (r) => r.dates || '—' },
  {
    id: 'inContent',
    header: 'In Content',
    width: 150,
    cell: (r) => (r.inContent ? `${plural(r.inContent, 'item')} in Content` : <span className="text-neutral-400">None yet</span>),
  },
];

export default function ResearchTopicsPage() {
  const router = useRouter();
  const list = useResearchList('topic', topicFilters);
  const ids = list.rows.map((t) => String(t.id));

  // One query for the drafts of THIS page of topics, not a scan of every draft.
  const drafts = useQuery({
    queryKey: ['research', 'topic-drafts', ids],
    enabled: ids.length > 0,
    queryFn: () =>
      listEntities('draft', 1, { ...projectFilters(), 'attr.topic_ref__in': ids.join(','), page_size: '200' }),
  });

  const rows = useMemo(() => {
    const counts = countDraftsByTopic(drafts.data?.results ?? []);
    return list.rows.map((t) => topicRow(t, counts[String(t.id)] ?? 0));
  }, [list.rows, drafts.data]);

  return (
    <div className="space-y-4">
      <ResearchHead title="Topics" sub={plural(list.total, 'topic')} />
      <UnifiedTable<TopicRow>
        tableId="research-topics"
        data={rows}
        columns={cols()}
        getRowId={(r) => r.id}
        loading={list.loading}
        onRowClick={(r) => router.push(`/research/topics/${r.id}`)}
        search={{ enabled: true, placeholder: 'Search topics…', value: list.search, onChange: list.setSearch, debounceMs: 300, preserveFocus: true }}
        pagination={tablePaging(list)}
        sorting={tableSorting(list)}
        emptyState={
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-neutral-500">
            {list.filtersApplied ? 'No topics match.' : 'No topics yet. Topics appear here as documents are collected from your sources.'}
          </p>
        }
      />
    </div>
  );
}
