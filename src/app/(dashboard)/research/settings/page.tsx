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

import { ResearchHead, plural } from '@/components/research/page-head';
import { RecordForm } from '@/components/record-form';
import { humanizeChoice, readData } from '@/lib/board';
import { listTypes, updateEntity, type EntityRecord } from '@/lib/foundry-api';
import { sourceFilters } from '@/lib/research/filters';
import { tablePaging, tableSorting, useResearchList } from '@/lib/research/use-list';

const str = (v: unknown) => (v == null ? '' : String(v));
const isOn = (s: EntityRecord) => readData(s.data, 'active') === true || readData(s.data, 'active') === 'true';

export default function ResearchSettingsPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const list = useResearchList('source', sourceFilters);
  const typesQuery = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });
  const sourceType = typesQuery.data?.results.find((t) => t.key === 'source') ?? null;

  const toggle = useMutation({
    mutationFn: (s: EntityRecord) => updateEntity(s.id, { data: { ...s.data, active: !isOn(s) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research', 'source'] }),
    onError: (err) => notify.error(err instanceof Error ? err.message : 'Could not save the source.'),
  });

  const columns: ColumnConfig<EntityRecord>[] = [
    { id: 'name', header: 'Name', cell: (s) => <span className="font-medium text-neutral-900">{s.name}</span> },
    { id: 'type', header: 'Type', sortable: true, width: 150, cell: (s) => humanizeChoice(str(readData(s.data, 'source_type'))) || '—' },
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
        sub={`${plural(list.total, 'source')} configured`}
        action={
          <Button onClick={() => setAdding(true)} disabled={!sourceType}>
            <Plus className="mr-1 h-4 w-4" />
            Add source
          </Button>
        }
      />
      <UnifiedTable<EntityRecord>
        tableId="research-settings"
        data={list.rows}
        columns={columns}
        getRowId={(s) => String(s.id)}
        loading={list.loading}
        search={{ enabled: true, placeholder: 'Search sources…', value: list.search, onChange: list.setSearch, debounceMs: 300, preserveFocus: true }}
        pagination={tablePaging(list)}
        sorting={tableSorting(list)}
        emptyState={
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-neutral-500">
            {list.filtersApplied ? 'No sources match.' : 'No sources configured yet. Add the outlets and providers documents are pulled from.'}
          </p>
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
