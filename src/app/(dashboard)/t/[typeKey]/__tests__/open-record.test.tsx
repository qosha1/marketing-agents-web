/**
 * /t/<type>?open=<id> lands ON a record (bd startsim-m7fdm.36): Activity links
 * an edit to a scope, source or news item here, and the reader should see that
 * record's drawer, not a whole table to search by hand.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

vi.mock('@startsimpli/ui', async () => {
  const React = await import('react');
  return {
    UnifiedTable: (props: { search?: { placeholder?: string }; emptyState?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'table', 'data-placeholder': props.search?.placeholder }, props.emptyState),
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) =>
      React.createElement('button', { onClick }, children),
    ABSENCE_DASH: '—',
    scopeAbsence: () => null,
    ScopeAbsence: () => null,
    ScopeNotice: () => null,
    BaseDialog: () => null,
  };
});
vi.mock('@startsimpli/ui/collection', async () => ({
  ...(await vi.importActual<typeof import('@startsimpli/ui/collection')>('@startsimpli/ui/collection')),
  ReviewDrawer: () => null,
  InlineReviewActions: () => null,
}));
vi.mock('@/components/entity-detail-drawer', async () => {
  const React = await import('react');
  return {
    EntityDetailDrawer: ({ record }: { record: EntityRecord | null }) =>
      record ? React.createElement('aside', { 'data-testid': 'drawer' }, record.name) : null,
    GoodExampleToggle: () => null,
    RecordEditFields: () => null,
    TopicDrafts: () => null,
    TopicReviewExtra: () => null,
  };
});
vi.mock('@/components/record-form', () => ({ RecordForm: () => null }));
vi.mock('next/link', async () => {
  const React = await import('react');
  return { default: ({ children, href }: { children?: ReactNode; href?: string }) => React.createElement('a', { href }, children) };
});
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ typeKey: 'scope' }),
  useSearchParams: () => new URLSearchParams('open=scope-3'),
  usePathname: () => '/t/scope',
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const SCOPE_TYPE = {
  id: 2,
  key: 'scope',
  label: 'Scope',
  attributes: [
    { id: 1, name: 'name', dataType: 'text', config: {} },
    { id: 2, name: 'kind', dataType: 'enum', config: { choices: ['client', 'project'] } },
  ],
} as unknown as EntityTypeDef;

const getEntity = vi.fn(async () => ({ id: 'scope-3', name: 'OGMC', data: {} }) as unknown as EntityRecord);
vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ results: [SCOPE_TYPE] })),
  listEntities: vi.fn(async () => ({ count: 0, results: [] })),
  listAllEntities: vi.fn(async () => []),
  getEntity: (...a: unknown[]) => getEntity(...(a as [])),
  fetchScopeAccess: vi.fn(async () => ({ access: null, readableCount: 0 })),
  collectionClient: { listTypes: vi.fn(), listAllEntities: vi.fn(), updateEntity: vi.fn() },
}));

import TypeRecordsPage from '../page';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TypeRecordsPage />
    </QueryClientProvider>,
  );
}

describe('/t/scope?open=<id>', () => {
  it('opens that record in the drawer and drops the param', async () => {
    mount();
    expect((await screen.findByTestId('drawer')).textContent).toBe('OGMC');
    expect(getEntity).toHaveBeenCalledWith('scope-3');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/t/scope'));
  });

  it('names the field a title-less type is searched by', async () => {
    mount();
    expect((await screen.findByTestId('table')).dataset.placeholder).toBe('Search by name…');
  });

  it('says once that the type is empty', async () => {
    mount();
    expect((await screen.findByTestId('records-empty')).textContent).toBe('No scope records yet.');
  });
});
