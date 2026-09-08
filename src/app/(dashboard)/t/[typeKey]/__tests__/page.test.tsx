/**
 * The records table's header count (bd startsim-8hgmq.16).
 *
 * MEASURED LIVE 2026-09-07 on /t/topic: the header said "84 total" while the
 * table rendered 68 rows. The 16 missing rows were the rejected pile exactly —
 * the topic table deliberately collapses rejected topics out of the review
 * queue, and the header was never told. A reviewer read 84, counted 68, and had
 * no way to learn where the rest went.
 *
 * The defect is a WIRING one: two correct numbers taken from two places. The
 * header read `filteredRecords.length` (everything that matched) while the body
 * rendered `visibleRecords` (that set minus the collapsed rejected rows). So
 * what is asserted here is not a formula but the join: THE NUMBER IN THE HEADER
 * IS THE LENGTH OF THE DATA HANDED TO THE TABLE, and the same number the table
 * is given as its pagination total. Derived from one expression, the two cannot
 * drift again.
 *
 * Deliberately NOT asserted: how many <tr> the shared table renders. UnifiedTable
 * does not slice its data for client-side pagination (bd startsim-b9v6p, owned in
 * packages/ui) — a "header == DOM rows" assertion would pass today only because
 * of that bug and go red the moment it is fixed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/** Only the props this bead is about — everything else the page passes is noise. */
interface TableStubProps {
  tableId?: string;
  data?: unknown[];
  loading?: boolean;
  pagination?: { totalCount?: number };
}

// The shared table is stubbed rather than mounted: this test is about the
// numbers the page HANDS it, and mounting the real one would drag in the
// pagination bug that belongs to another bead.
vi.mock('@startsimpli/ui', async () => {
  const React = await import('react');
  return {
    UnifiedTable: (props: TableStubProps) =>
      React.createElement('div', {
        'data-testid': `table-${props.tableId}`,
        'data-rows': String(props.data?.length ?? 0),
        'data-total': String(props.pagination?.totalCount ?? ''),
        'data-loading': String(props.loading ?? false),
      }),
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) =>
      React.createElement('button', { onClick }, children),
    BaseDialog: () => null,
  };
});
vi.mock('@startsimpli/ui/collection', () => ({
  ReviewDrawer: () => null,
  InlineReviewActions: () => null,
}));
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
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/t/topic',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 10, name: 'title', label: 'Title', dataType: 'string', config: {} },
    {
      id: 11,
      name: 'status',
      label: 'Status',
      dataType: 'enum',
      config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
    },
  ],
} as unknown as EntityTypeDef;

/** 5 topics, 2 of them rejected — the live 84/68/16 split at readable scale. */
const TOPICS: EntityRecord[] = [
  { id: 1, name: 'Qatar LNG expansion', data: { title: 'Qatar LNG expansion', status: 'suggested' } },
  { id: 2, name: 'Dubai manufacturing park', data: { title: 'Dubai manufacturing park', status: 'rejected' } },
  { id: 3, name: 'Saudi hydrogen corridor', data: { title: 'Saudi hydrogen corridor', status: 'ready' } },
  { id: 4, name: 'Kuwait refinery restart', data: { title: 'Kuwait refinery restart', status: 'rejected' } },
  { id: 5, name: 'Oman solar tender', data: { title: 'Oman solar tender', status: 'written' } },
] as unknown as EntityRecord[];

vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ results: [TOPIC_TYPE] })),
  listEntities: vi.fn(async () => ({ count: 0, results: [] })),
  listAllEntities: vi.fn(async () => TOPICS),
  collectionClient: { listTypes: vi.fn(), listAllEntities: vi.fn(), updateEntity: vi.fn() },
}));

import TypeRecordsPage from '../page';

/** The table exists from the first paint; the numbers only mean anything once
 *  the (bounded) full fetch has landed. */
async function loadedTable(): Promise<HTMLElement> {
  const table = await screen.findByTestId('table-records-topic');
  await waitFor(() => expect(table.dataset.loading).toBe('false'));
  return table;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TypeRecordsPage />
    </QueryClientProvider>,
  );
}

/** The digits the header states, whatever prose surrounds them. */
function headerNumber(): number {
  const el = screen.getByTestId('record-count');
  const m = /(\d+)/.exec(el.textContent ?? '');
  if (!m) throw new Error(`no number in the header count: "${el.textContent}"`);
  return Number(m[1]);
}

describe('the topic table header count', () => {
  it('states the size of the list it is standing over, not of the rows it hides', async () => {
    renderPage();
    const table = await loadedTable();

    // The join. Three readings of one number: what the header claims, what the
    // body was handed, and what the table paginates over.
    expect(Number(table.dataset.rows)).toBe(3);
    expect(headerNumber()).toBe(3);
    expect(table.dataset.total).toBe('3');
    // Never the whole matched set — that is the 84 the reviewer could not find.
    expect(headerNumber()).not.toBe(TOPICS.length);
  });

  it('names the rejected rows it withheld, and that name opens them', async () => {
    renderPage();
    await loadedTable();

    // Naming the hidden pile is the other half: "3 shown" alone still leaves a
    // reviewer wondering where the other two went.
    const header = screen.getByTestId('record-count');
    expect(header).toHaveTextContent('3 shown');
    expect(header).toHaveTextContent('2 rejected');

    // And the figure has to REACH them — the rejected pile's only entry point is
    // a disclosure below the fold that nobody scrolls to.
    fireEvent.click(screen.getByRole('button', { name: /2 rejected/i }));
    await waitFor(() => {
      expect(screen.getByTestId('table-records-topic-rejected').dataset.rows).toBe('2');
    });
  });
});
