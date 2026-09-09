/**
 * The Drafts queue says how much of itself it is hiding (bd startsim-onrb7,
 * bd startsim-sr38f).
 *
 * The default view narrows hard — approved topic, last 7 days, and now no
 * platform-test drafts — and until this bead the header said "36 total" over a
 * table of 156 drafts. That is the shape of bd startsim-8hgmq.16 all over again:
 * a number that describes something other than the corpus, with no disclosure of
 * what went missing. It matters twice over here, because the 38 drafts that
 * carry no topic at all (bd startsim-sr38f) have no other way of being noticed.
 *
 * THE TRAP THIS FILE EXISTS TO PIN. `listAllEntities('draft', …)` is ALREADY
 * server-narrowed by `attr.topic_ref__in`, so `allQuery.data.length` is not the
 * size of the type — it is the size of the gate's result. Subtracting the
 * visible rows from THAT undercounts by every orphan the server excluded, which
 * would state a hidden-count as confidently wrong as the one it replaced. The
 * total has to come from a request the default view cannot narrow.
 *
 * So the fixture deliberately makes the two answers differ: four drafts come
 * back from the narrowed fetch, two survive the client gates, and the type holds
 * 156. The honest answer is 154 hidden. The naive one is 2.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import type { EntityRecord, EntityTypeDef, MemberRow } from '@/lib/foundry-api';

interface TableStubProps {
  tableId?: string;
  data?: unknown[];
  loading?: boolean;
  pagination?: { totalCount?: number };
}

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

const replace = vi.fn();
/** The URL the page is standing on. Mutable so a test can land on a facet. */
let SEARCH = '';
vi.mock('next/navigation', () => ({
  useParams: () => ({ typeKey: 'draft' }),
  useSearchParams: () => new URLSearchParams(SEARCH),
  usePathname: () => '/t/draft',
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const DRAFT_TYPE = {
  id: 2,
  key: 'draft',
  label: 'Draft',
  attributes: [
    { id: 20, name: 'story_title', label: 'Story title', dataType: 'string', config: {} },
    {
      id: 21,
      name: 'status',
      label: 'Status',
      dataType: 'enum',
      config: { choices: ['ready_for_review', 'approved'] },
    },
    { id: 22, name: 'topic_ref', label: 'Topic', dataType: 'string', config: {} },
  ],
} as unknown as EntityTypeDef;

const TOPIC_TYPE = { id: 1, key: 'topic', label: 'Topic', attributes: [] } as unknown as EntityTypeDef;

const APPROVED_TOPICS: EntityRecord[] = [
  { id: 'T1', name: 'UAE fee reform', data: { status: 'ready' } },
] as unknown as EntityRecord[];

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/**
 * What the SERVER hands back under `attr.topic_ref__in=T1` — already narrowed.
 * Two survive the client gates: one is a platform-test draft (owned by the QA
 * account's sub) and one is outside the 7-day window.
 */
const NARROWED_DRAFTS: EntityRecord[] = [
  {
    id: 1,
    name: 'Dubai duty threshold',
    data: { topic_ref: 'T1', status: 'approved' },
    ownerSub: 'svc:n8n-ogmc',
    createdAt: ago(1),
  },
  { id: 2, name: 'Oman e-invoicing', data: { topic_ref: 'T1' }, ownerSub: 'svc:n8n-ogmc', createdAt: ago(2) },
  { id: 3, name: '阿联酋数字化许可工具', data: { topic_ref: 'T1' }, ownerSub: 'sub-qa', createdAt: ago(1) },
  { id: 4, name: 'Qatar market entry', data: { topic_ref: 'T1' }, ownerSub: 'svc:n8n-ogmc', createdAt: ago(40) },
] as unknown as EntityRecord[];

/** The live roster shape: the platform's QA account sits alongside the customer. */
const MEMBERS: MemberRow[] = [
  { id: 1, user: { sub: 'sub-qa', email: 'qa-marketing-agents@startsimpli.com' }, role: 'admin' },
  { id: 2, user: { sub: 'f496dea4', email: 'schilder@ogmc.ai' }, role: 'member' },
];

vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ results: [DRAFT_TYPE, TOPIC_TYPE] })),
  // The one request the default view cannot narrow: page 1 of the whole type.
  listEntities: vi.fn(async () => ({ count: 156, results: NARROWED_DRAFTS.slice(0, 1) })),
  listAllEntities: vi.fn(async (typeKey: string) =>
    typeKey === 'topic' ? APPROVED_TOPICS : NARROWED_DRAFTS,
  ),
  orgMembers: vi.fn(async () => MEMBERS),
  collectionClient: { listTypes: vi.fn(), listAllEntities: vi.fn(), updateEntity: vi.fn() },
}));

import TypeRecordsPage from '../page';

beforeEach(() => {
  SEARCH = '';
  replace.mockClear();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TypeRecordsPage />
    </QueryClientProvider>,
  );
}

async function loadedTable(): Promise<HTMLElement> {
  const table = await screen.findByTestId('table-records-draft');
  await waitFor(() => expect(table.dataset.loading).toBe('false'));
  return table;
}

describe('the Drafts queue names what its default view withheld', () => {
  it('states the shown count AND the hidden count, measured against the whole type', async () => {
    renderPage();
    const table = await loadedTable();

    await waitFor(() => expect(table.dataset.rows).toBe('2'));
    const header = screen.getByTestId('record-count');
    expect(header).toHaveTextContent('2 shown');
    // 156 in the type, 2 on screen. NOT 2 — the narrowed fetch's own length
    // minus the visible rows, which is what a header derived from
    // `allQuery.data` would say while every orphan stayed uncounted.
    expect(header).toHaveTextContent('154 hidden');
    expect(header).not.toHaveTextContent('2 hidden');
  });

  it('hides the platform team’s test draft and keeps the customer’s', async () => {
    renderPage();
    const table = await loadedTable();

    // Row 3 is owned by qa-marketing-agents@startsimpli.com. Three of the four
    // rows the server returned are in the window; only two reach the table.
    await waitFor(() => expect(table.dataset.rows).toBe('2'));
    expect(table.dataset.total).toBe('2');
  });

  it('turns the whole default off from the number itself', async () => {
    renderPage();
    await loadedTable();
    replace.mockClear();

    // The count is the disclosure AND the way out of it. All three halves clear
    // together: every topic-less draft is months old, so dropping the topic gate
    // on its own would surface none of them.
    fireEvent.click(screen.getByRole('button', { name: /154 hidden/i }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const url = String(replace.mock.calls[0][0]);
    expect(url).toContain('topic=all');
    expect(url).toContain('since=all');
    expect(url).toContain('made=all');
  });
});

describe('the hidden count under an active facet', () => {
  it('counts the facet’s rows as hidden AND clears the facet when clicked', async () => {
    // A Kind/State facet narrows `displayCount` too, so it feeds the hidden
    // figure. A click that cleared only the three view params would state a
    // number and hand back a smaller list — bd startsim-8hgmq.16 restated inside
    // the one control written to fix it.
    SEARCH = 'status=approved';
    renderPage();
    const table = await screen.findByTestId('table-records-draft');
    await waitFor(() => expect(table.dataset.loading).toBe('false'));
    await waitFor(() => expect(table.dataset.rows).toBe('1'));

    const header = screen.getByTestId('record-count');
    expect(header).toHaveTextContent('1 shown');
    expect(header).toHaveTextContent('155 hidden');

    fireEvent.click(screen.getByRole('button', { name: /155 hidden/i }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    // ONE replace, not a view-params call racing a filters call.
    expect(replace).toHaveBeenCalledTimes(1);
    const url = String(replace.mock.calls[0][0]);
    expect(url).toContain('topic=all');
    expect(url).toContain('since=all');
    expect(url).toContain('made=all');
    expect(url).not.toContain('status=approved');
  });
});
