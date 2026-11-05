'use client';

/**
 * Research > Settings: which outlets and providers documents are pulled from
 * (bd startsim-pwdbi). The existing `source` entity: name, type, domain, tier,
 * active. Add source opens the shared create form; the On / Off cell flips active.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BaseDialog, Button, UnifiedTable, notify, type ColumnConfig } from '@startsimpli/ui';
import { Plus } from 'lucide-react';

import { ResearchToolbar } from '@/components/research/list-toolbar';
import { ResearchHead, plural } from '@/components/research/page-head';
import { RecordForm } from '@/components/record-form';
import { humanizeChoice, readData } from '@/lib/board';
import { listEntities, listTypes, updateEntity, type EntityRecord } from '@/lib/foundry-api';
import { sourceFilters, type SourceQuery } from '@/lib/research/filters';
import { agoText } from '@/lib/research/topics';
import { tablePaging, tableSorting, useResearchList } from '@/lib/research/use-list';

const str = (v: unknown) => (v == null ? '' : String(v));
const isOn = (s: EntityRecord) => readData(s.data, 'active') === true || readData(s.data, 'active') === 'true';

export default function ResearchSettingsPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('');
  const [active, setActive] = useState<NonNullable<SourceQuery['active']>>('all');
  const list = useResearchList('source', ({ search, sort }) => sourceFilters({ search, sort, type, active }), [type, active]);
  const typesQuery = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });
  const sourceType = typesQuery.data?.results.find((t) => t.key === 'source') ?? null;
  const typeChoices = ((sourceType?.attributes.find((a) => a.name === 'source_type')?.config as { choices?: string[] } | undefined)?.choices ?? []);
  // Whether documents are still arriving: the newest one's age.
  const latest = useQuery({
    queryKey: ['research', 'latest-document'],
    queryFn: () => listEntities('news_item', 1, { page_size: '1' }),
  });
  const newest = latest.data?.results[0];

  const toggle = useMutation({
    mutationFn: (s: EntityRecord) => updateEntity(s.id, { data: { ...s.data, active: !isOn(s) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research', 'source'] }),
    onError: (err) => notify.error(err instanceof Error ? err.message : 'Could not save the source.'),
  });

  const columns: ColumnConfig<EntityRecord>[] = [
    { id: 'name', header: 'Name', sortable: true, cell: (s) => <span className="font-medium text-neutral-900">{s.name}</span> },
    { id: 'type', header: 'Type', sortable: true, width: 160, cell: (s) => <span className="whitespace-nowrap">{humanizeChoice(str(readData(s.data, 'source_type'))) || '—'}</span> },
    { id: 'domain', header: 'Domain', sortable: true, width: 170, cell: (s) => str(readData(s.data, 'domain')) || '—' },
    { id: 'tier', header: 'Tier', sortable: true, width: 90, cell: (s) => str(readData(s.data, 'tier')) || '—' },
    {
      id: 'active',
      header: 'Active',
      sortable: true,
      width: 90,
      cell: (s) => (
        <button
          type="button"
          aria-pressed={isOn(s)}
          onClick={() => toggle.mutate(s)}
          className={`rounded-md border px-2 py-1 text-xs ${isOn(s) ? 'border-green-600 text-green-700' : 'border-border text-neutral-500'}`}
        >
          {isOn(s) ? 'On' : 'Off'}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <ResearchHead
        title="Settings"
        count={`${plural(list.total, 'source')} configured`}
        sub={
          latest.isSuccess
            ? newest
              ? `Articles are arriving. Last one ${agoText(newest.createdAt)}.`
              : 'No articles have arrived yet.'
            : undefined
        }
        action={
          <Button onClick={() => setAdding(true)} disabled={!sourceType}>
            <Plus className="mr-1 h-4 w-4" />
            Add source
          </Button>
        }
      />
      <ResearchToolbar
        search={list.search}
        onSearch={list.setSearch}
        placeholder="Search sources…"
        menus={[
          {
            id: 'Type',
            value: type,
            onChange: (v) => {
              setType(v);
              list.setPage(1);
            },
            options: [{ value: '', label: 'Type' }, ...typeChoices.map((c) => ({ value: c, label: humanizeChoice(c) }))],
          },
          {
            id: 'Active',
            value: active,
            onChange: (v) => {
              setActive(v as typeof active);
              list.setPage(1);
            },
            options: [
              { value: 'all', label: 'Active' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ],
          },
        ]}
      />
      <UnifiedTable<EntityRecord>
        tableId="research-settings"
        data={list.rows}
        columns={columns}
        getRowId={(s) => String(s.id)}
        loading={list.loading}
        // The table draws its Columns menu on a row of its own; the wireframe has it at the right of the toolbar.
        className="relative [&>div:first-child]:absolute [&>div:first-child]:-top-[52px] [&>div:first-child]:right-0 [&>div:first-child]:m-0"
        columnVisibility={{ enabled: true, alwaysVisible: ['name'], persistKey: 'research-settings-columns' }}
        pagination={tablePaging(list)}
        sorting={tableSorting(list)}
        emptyState={
          list.filtersApplied || type || active !== 'all' ? (
            <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-neutral-600">No sources match.</p>
          ) : (
            <section className="space-y-3 rounded-lg border border-dashed px-4 py-10 text-center">
              <p className="text-sm font-medium text-neutral-900">No sources configured yet</p>
              <p className="text-sm text-neutral-500">Add the outlets and providers documents are pulled from.</p>
              <Button onClick={() => setAdding(true)} disabled={!sourceType}>
                Add source
              </Button>
            </section>
          )
        }
      />
      <BaseDialog open={adding} onOpenChange={setAdding} size="lg">
        {sourceType ? (
          <RecordForm
            type={sourceType}
            defaults={{ active: true }}
            onSuccess={() => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ['research', 'source'] });
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
      </BaseDialog>
    </div>
  );
}
