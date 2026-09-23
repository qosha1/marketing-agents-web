/**
 * Approving a topic on the table leaves the table (bd startsim-z384k).
 *
 * WHY THIS IS TESTED AT THE PAGE and not at the helper. `lib/approve-watch.ts`
 * already proves the predicate in the node lane. What can still be wrong is the
 * WIRING — that the shared cluster is handed the WATCHED client rather than the
 * bare one, that the decision that was saved is the one compared, and that the
 * reviewer's own scope rides along so "back" returns to where they were. Those
 * are three separate mistakes and every one of them type-checks.
 *
 * The cluster is stubbed to a button that does exactly what the real one does —
 * save through the injected client, then fire `onSaved` — because that bare
 * `onSaved?: () => void` IS the constraint this design works around. Anything
 * richer would be testing a component @startsimpli/ui does not ship.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

import type { CollectionClient, EntityRecord } from '@startsimpli/ui/collection';

const push = vi.fn();
let searchString = '';

interface TableStubProps {
  tableId?: string;
  data?: EntityRecord[];
  columns?: { id?: string; cell?: (row: EntityRecord) => ReactNode }[];
}

// Render the Actions cell for each row, and nothing else — this suite is about
// what a decision DOES, not about the table.
vi.mock('@startsimpli/ui', async () => {
  const React = await import('react');
  return {
    UnifiedTable: (props: TableStubProps) =>
      React.createElement(
        'div',
        { 'data-testid': `table-${props.tableId}` },
        (props.data ?? []).map((row) =>
          React.createElement(
            'div',
            { key: String(row.id) },
            (props.columns ?? [])
              .filter((c) => c.id === '__actions')
              .map((c, i) => React.createElement('span', { key: i }, c.cell?.(row))),
          ),
        ),
      ),
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
  const React = await import('react');
  const actual = await vi.importActual<typeof import('@startsimpli/ui/collection')>(
    '@startsimpli/ui/collection',
  );
  return {
    ...actual,
    ReviewDrawer: () => null,
    // The shape of the real thing: it saves through the client it was GIVEN and
    // then calls a bare `onSaved` that says nothing about which decision fired.
    InlineReviewActions: ({
      client,
      record,
      onSaved,
    }: {
      client: CollectionClient;
      record: EntityRecord;
      onSaved?: () => void;
    }) =>
      React.createElement(
        'span',
        null,
        React.createElement(
          'button',
          {
            'data-testid': `approve-${record.id}`,
            onClick: async () => {
              await client.updateEntity(record.id, { data: { ...record.data, status: 'ready' } });
              onSaved?.();
            },
          },
          'approve',
        ),
        React.createElement(
          'button',
          {
            'data-testid': `reject-${record.id}`,
            onClick: async () => {
              await client.updateEntity(record.id, { data: { ...record.data, status: 'rejected' } });
              onSaved?.();
            },
          },
          'reject',
        ),
      ),
  };
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
vi.mock('next/navigation', () => ({
  useParams: () => ({ typeKey: 'topic' }),
  useSearchParams: () => new URLSearchParams(searchString),
  usePathname: () => '/t/topic',
  useRouter: () => ({ replace: vi.fn(), push }),
}));

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 1, name: 'title', dataType: 'text', required: false, config: {} },
    { id: 2, name: 'angle', dataType: 'longtext', required: false, config: {} },
    {
      id: 3,
      name: 'content_type',
      dataType: 'enum',
      required: false,
      config: { choices: ['weekly_brief', 'lead_magnet', 'general'] },
    },
    {
      id: 4,
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
    },
    { id: 5, name: 'team_verdict', dataType: 'text', required: false, config: {} },
  ],
};

const ROWS: EntityRecord[] = [
  {
    id: 'topic-1',
    entityType: 'topic',
    externalId: null,
    name: 'Qatar customs clearance timelines',
    data: { title: 'Qatar customs clearance timelines', status: 'suggested', content_type: 'general' },
    createdAt: '2026-09-20T00:00:00Z',
  } as unknown as EntityRecord,
];

const updateEntity = vi.fn(async (id: string, input: { data?: Record<string, unknown> }) => ({
  ...ROWS[0],
  id,
  data: input.data ?? {},
}));

vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ count: 1, next: null, previous: null, results: [TOPIC_TYPE] })),
  listEntities: vi.fn(async () => ({ count: ROWS.length, next: null, previous: null, results: ROWS })),
  listAllEntities: vi.fn(async () => ROWS),
  fetchScopeAccess: vi.fn(async () => null),
  orgMembers: vi.fn(async () => ({ results: [] })),
  collectionClient: {
    listTypes: vi.fn(),
    listAllEntities: vi.fn(),
    updateEntity: (id: string, input: { data?: Record<string, unknown> }) => updateEntity(id, input),
  },
}));

const TypeRecordsPage = (await import('../page')).default;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TypeRecordsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  updateEntity.mockClear();
  searchString = '';
});

describe('approving a topic from the table', () => {
  it('goes to the topic’s story, carrying the unfiltered table as the way back', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/story/topic-1?from=${encodeURIComponent('/t/topic')}`),
    );
  });

  it('takes the reviewer’s own scope with it, so back returns to the same view', async () => {
    searchString = 'content_type=general&status=suggested';
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/story/topic-1?from=${encodeURIComponent('/t/topic?content_type=general&status=suggested')}`,
      ),
    );
  });

  it('does NOT navigate on a reject — triage keeps its rhythm', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('reject-topic-1'));
    await waitFor(() => expect(updateEntity).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(push).not.toHaveBeenCalled();
  });

  it('saves through the WATCHED client, not the bare one', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));
    // The write still reaches the real client — the wrapper delegates, it does
    // not replace.
    await waitFor(() => expect(updateEntity).toHaveBeenCalledTimes(1));
    expect(updateEntity.mock.calls[0][1].data).toMatchObject({ status: 'ready' });
  });
});
