/**
 * The State chip row on a type whose enum is not called `status`
 * (bd startsim-lkcpn, SRC-001).
 *
 * pickStatusAttr falls back to the type's FIRST enum when none is named
 * `status`. On Approved Source that is `source_type`, so the chip row offered
 * state_wire / government_body / ... — but it was keyed on a hardcoded
 * `status`, labelled "State", and filtered rows on a `status` field no source
 * record has. Picking state_wire emptied a populated table.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

interface ChipFilter {
  id: string;
  label: string;
  options: string[];
}
interface TableStubProps {
  tableId?: string;
  data?: { id: number }[];
  loading?: boolean;
  filters?: { config?: { sections?: { filters: ChipFilter[] }[] } };
}

vi.mock('@startsimpli/ui', async () => {
  const React = await import('react');
  return {
    UnifiedTable: (props: TableStubProps) => {
      const chips = (props.filters?.config?.sections ?? []).flatMap((s) => s.filters);
      return React.createElement('div', {
        'data-testid': `table-${props.tableId}`,
        'data-rows': (props.data ?? []).map((r) => r.id).join(','),
        'data-loading': String(props.loading ?? false),
        'data-chips': JSON.stringify(chips.map((c) => ({ id: c.id, label: c.label }))),
      });
    },
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) =>
      React.createElement('button', { onClick }, children),
    ABSENCE_DASH: '—',
    scopeAbsence: () => null,
    ScopeAbsence: () => null,
    ScopeNotice: () => null,
    BaseDialog: () => null,
  };
});
vi.mock('@startsimpli/ui/collection', async () => {
  const actual = await vi.importActual<typeof import('@startsimpli/ui/collection')>(
    '@startsimpli/ui/collection',
  );
  return { ...actual, ReviewDrawer: () => null, InlineReviewActions: () => null };
});
vi.mock('@/components/entity-detail-drawer', () => ({
  EntityDetailDrawer: () => null,
  GoodExampleToggle: () => null,
  RecordEditFields: () => null,
  TopicDrafts: () => null,
}));
vi.mock('@/components/record-form', () => ({ RecordForm: () => null }));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ children, href }: { children?: ReactNode; href?: string }) =>
      React.createElement('a', { href }, children),
  };
});

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ typeKey: 'source' }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/t/source',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// The real source type's shape (local-stack/schema/marketing-agents.json):
// one enum, `source_type`, and no `status`.
const SOURCE_TYPE = {
  id: 3,
  key: 'source',
  label: 'Source',
  attributes: [
    { id: 30, name: 'domain', label: 'Domain', dataType: 'text', config: {} },
    {
      id: 31,
      name: 'source_type',
      label: 'Source type',
      dataType: 'enum',
      config: { choices: ['state_wire', 'government_body', 'independent_press'] },
    },
  ],
} as unknown as EntityTypeDef;

const SOURCES: EntityRecord[] = [
  { id: 1, name: 'wam.ae', data: { domain: 'wam.ae', sourceType: 'state_wire' } },
  { id: 2, name: 'spa.gov.sa', data: { domain: 'spa.gov.sa', sourceType: 'state_wire' } },
  { id: 3, name: 'thenational.ae', data: { domain: 'thenational.ae', sourceType: 'independent_press' } },
] as unknown as EntityRecord[];

vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ results: [SOURCE_TYPE] })),
  listEntities: vi.fn(async () => ({ count: SOURCES.length, results: SOURCES })),
  listAllEntities: vi.fn(async () => SOURCES),
  fetchScopeAccess: vi.fn(async () => ({ access: null, readableCount: SOURCES.length })),
  collectionClient: { listTypes: vi.fn(), listAllEntities: vi.fn(), updateEntity: vi.fn() },
}));

import TypeRecordsPage from '../page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TypeRecordsPage />
    </QueryClientProvider>,
  );
}

async function loadedTable(): Promise<HTMLElement> {
  const table = await screen.findByTestId('table-records-source');
  await waitFor(() => expect(table.dataset.loading).toBe('false'));
  await waitFor(() => expect(table.dataset.rows).not.toBe(''));
  return table;
}

describe('the chip row on a type whose enum is not status', () => {
  beforeEach(() => {
    nav.search = '';
  });

  it('is keyed on that enum and named after it', async () => {
    renderPage();
    const table = await loadedTable();
    expect(JSON.parse(table.dataset.chips ?? '[]')).toEqual([
      { id: 'source_type', label: 'Source type' },
    ]);
  });

  it('keeps the rows that carry the picked value', async () => {
    nav.search = 'source_type=state_wire';
    renderPage();
    const table = await loadedTable();
    expect(table.dataset.rows).toBe('1,2');
  });
});
