/**
 * The "No test drafts" gate keeps working, and says what it could not check,
 * when the roster read is refused (bd startsim-m7fdm.9).
 *
 * WHAT WAS WRONG. `GET /api/v1/org/members/` needs an admin-tier bearer
 * (bd startsim-q79l), so for a member-role reviewer it answers 403 — measured
 * live 2026-10-05 as qa+ma@startsimpli.com, on both path forms. The page treated
 * that one failure as the whole gate failing: it filtered the chip out of
 * `viewChips` and skipped `applyOriginGate` entirely. The filter that keeps the
 * platform team's test drafts out of a reviewer's queue was therefore off for
 * exactly the people it protects, with nothing on screen saying so.
 *
 * WHY THE GATE DOES NOT ACTUALLY NEED THE ROSTER. `applyOriginGate` has two
 * halves (lib/drafts-view.ts `madeByOperator`): `owner_sub` ∈ operatorSubs,
 * which needs the roster to resolve a sub to a person, and
 * `isOperatorEmail(_triggered_by)`, which reads a domain off the row itself and
 * needs nothing. Over the 169 live drafts on 2026-10-05 the second half names
 * five rows (`qa+ma@startsimpli.com` ×4, `qosha@debugg.ai` ×1) and the first
 * names three. So a 403 costs the owner half and nothing else — the gate runs,
 * narrower than it would with a roster, and the page discloses which half it
 * could not run rather than dropping the chip.
 *
 * The honest-degradation precedent is on this very page: the topic gate already
 * renders "Could not check which topics are approved — showing drafts
 * unfiltered" beside its chips, and the sibling AssigneePicker degrades to a
 * text input reading "roster unavailable — admin role required"
 * (components/entity-detail-drawer.tsx). This gate was the one surface that
 * degraded silently.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

const replace = vi.fn();
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
 * Three drafts, all in the window and all on the approved topic — one per way a
 * draft can be attributed, which is what makes the two halves separable:
 *
 *   customer   written by the pipeline, nobody named     visible
 *   ours-row   `_triggered_by` on a platform domain      hidden with NO roster
 *   ours-sub   owned by a platform QA person's sub       needs the roster
 */
const DRAFTS: EntityRecord[] = [
  {
    id: 'customer',
    name: 'Dubai duty threshold',
    data: { topic_ref: 'T1', status: 'ready_for_review' },
    ownerSub: 'svc:n8n-ogmc',
    createdAt: ago(1),
  },
  {
    id: 'ours-row',
    name: 'Platform smoke test',
    data: { topic_ref: 'T1', status: 'ready_for_review', _triggered_by: 'qa+ma@startsimpli.com' },
    ownerSub: 'svc:n8n-ogmc',
    createdAt: ago(1),
  },
  {
    id: 'ours-sub',
    name: '阿联酋数字化许可工具',
    data: { topic_ref: 'T1', status: 'ready_for_review' },
    ownerSub: 'sub-qa',
    createdAt: ago(1),
  },
] as unknown as EntityRecord[];

const MEMBERS: MemberRow[] = [
  { id: 1, user: { sub: 'sub-qa', email: 'qa-marketing-agents@startsimpli.com' }, role: 'admin' },
  { id: 2, user: { sub: 'f496dea4', email: 'schilder@ogmc.ai' }, role: 'member' },
];

/** Flipped per test: a member-role reader gets the 403, an admin gets the list. */
let ROSTER_REFUSED = true;

vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ results: [DRAFT_TYPE, TOPIC_TYPE] })),
  listEntities: vi.fn(async () => ({ count: 3, results: DRAFTS.slice(0, 1) })),
  listAllEntities: vi.fn(async (typeKey: string) =>
    typeKey === 'topic' ? APPROVED_TOPICS : DRAFTS,
  ),
  orgMembers: vi.fn(async () => {
    // The live refusal: `GET /api/v1/org/members/` -> 403 for role=member.
    if (ROSTER_REFUSED) throw new Error('Request failed with status 403');
    return MEMBERS;
  }),
  fetchScopeAccess: vi.fn(async () => ({ access: null, readableCount: 3 })),
  collectionClient: { listTypes: vi.fn(), listAllEntities: vi.fn(), updateEntity: vi.fn() },
}));

import TypeRecordsPage from '../page';

beforeEach(() => {
  SEARCH = '';
  ROSTER_REFUSED = true;
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

describe('the test-draft gate when the roster is refused (role=member)', () => {
  it('still hides the drafts the row itself attributes to us', async () => {
    renderPage();
    const table = await loadedTable();
    // `ours-row` goes, because `_triggered_by` is read off the draft and needs
    // no roster. `ours-sub` stays, because resolving a sub to a person does.
    await waitFor(() => expect(table.dataset.rows).toBe('2'));
  });

  it('keeps the "No test drafts" chip, because the gate is running', async () => {
    renderPage();
    await loadedTable();
    expect(screen.getByRole('button', { name: /No test drafts/i })).toBeInTheDocument();
  });

  it('says out loud which half it could not check', async () => {
    renderPage();
    await loadedTable();
    // The AssigneePicker's wording, in the same words, for the same 403.
    expect(screen.getByText(/roster unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/admin role/i)).toBeInTheDocument();
  });
});

describe('the same gate with a roster it is allowed to read (role=admin)', () => {
  it('hides both, and says nothing about a missing roster', async () => {
    ROSTER_REFUSED = false;
    renderPage();
    const table = await loadedTable();
    await waitFor(() => expect(table.dataset.rows).toBe('1'));
    expect(screen.getByRole('button', { name: /No test drafts/i })).toBeInTheDocument();
    expect(screen.queryByText(/roster unavailable/i)).toBeNull();
  });
});
