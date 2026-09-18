/**
 * A scope-restricted member is told WHY /t/draft is empty (bd startsim-44bar).
 *
 * FOUND IN THE BROWSER 2026-09-17, the day the scope axis went live on the
 * marketing-agents tenant: a member holding no grant read "0 total", "No
 * results found.", "No items" — and the API had already said exactly why. Every
 * list envelope for a non-exempt caller carries `scope_access`; this page threw
 * it away. That is the 2026-08-20 blackout shape, a plausible empty answer
 * nobody thinks to distrust, and the next person to meet it concludes the app
 * lost their content.
 *
 * THE REAL DECIDER RUNS HERE. `@startsimpli/ui` is stubbed for the table (this
 * suite is about what the page renders, not about the shared table), but the
 * scope exports come from `importActual`: a mock that re-derives the verdict
 * would pass whatever the page happened to do.
 *
 * The probe fixtures are the live marketing-agents report, copied from
 * `GET /api/v1/entities/?type=draft` on 2026-09-17.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

interface TableStubProps {
  tableId?: string;
  data?: unknown[];
  loading?: boolean;
}

vi.mock('@startsimpli/ui', async () => {
  const React = await import('react');
  const actual = await vi.importActual<typeof import('@startsimpli/ui')>('@startsimpli/ui');
  return {
    UnifiedTable: (props: TableStubProps) =>
      React.createElement('div', {
        'data-testid': `table-${props.tableId}`,
        'data-rows': String(props.data?.length ?? 0),
        'data-loading': String(props.loading ?? false),
      }),
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) =>
      React.createElement('button', { onClick }, children),
    BaseDialog: () => null,
    ABSENCE_DASH: actual.ABSENCE_DASH,
    scopeAbsence: actual.scopeAbsence,
    ScopeAbsence: actual.ScopeAbsence,
    ScopeNotice: actual.ScopeNotice,
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
  useParams: () => ({ typeKey: 'draft' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/t/draft',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const DRAFT_TYPE = {
  id: 2,
  key: 'draft',
  label: 'Draft',
  attributes: [{ id: 20, name: 'story_title', label: 'Story title', dataType: 'string', config: {} }],
} as unknown as EntityTypeDef;
const TOPIC_TYPE = { id: 1, key: 'topic', label: 'Topic', attributes: [] } as unknown as EntityTypeDef;

const READABLE_DRAFTS: EntityRecord[] = [
  {
    id: 1,
    name: 'Qatar customs timelines',
    data: { story_title: 'Qatar customs timelines', scope_path: '/ogmc-agent-test' },
    ownerSub: 'svc:n8n-ogmc',
    createdAt: new Date().toISOString(),
  },
] as unknown as EntityRecord[];

const NO_GRANT = {
  scopedTypes: ['draft', 'scope', 'topic'],
  exempt: false,
  grantedPaths: [],
  detail:
    'records of draft, scope, topic are scoped, and this account holds no scope grant, ' +
    'so it reads none of them. An admin grants a scope by sharing that scope’s own ' +
    'record (POST /api/v1/grants/ naming the scope row and this user).',
};
const ONE_SCOPE = {
  scopedTypes: ['draft', 'scope', 'topic'],
  exempt: false,
  grantedPaths: ['/ogmc-agent-test'],
};

/** What the unfiltered probe answers. Set per test before rendering. */
const probe = { access: null as unknown, readableCount: 0 };

vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ results: [DRAFT_TYPE, TOPIC_TYPE] })),
  listEntities: vi.fn(async () => ({ count: probe.readableCount, results: [] })),
  listAllEntities: vi.fn(async (typeKey: string) =>
    typeKey === 'topic' ? [] : probe.readableCount > 0 ? READABLE_DRAFTS : [],
  ),
  orgMembers: vi.fn(async () => []),
  collectionClient: { listTypes: vi.fn(), listAllEntities: vi.fn(), updateEntity: vi.fn() },
  fetchScopeAccess: vi.fn(async () => probe),
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

describe('/t/draft for a scope-gated member', () => {
  it('holding NO scope: an Absence naming the cause and the remedy, not an empty table', async () => {
    probe.access = NO_GRANT;
    probe.readableCount = 0;
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelector('[data-scope-absence="no-grant"]')).toBeTruthy(),
    );
    expect(screen.getByText('This account holds no scope, so it reads no records')).toBeInTheDocument();
    // The backend's own remedy sentence reaches the screen rather than being
    // paraphrased into something that has drifted from what an admin must do.
    expect(screen.getByText(/POST \/api\/v1\/grants\//)).toBeInTheDocument();

    // The table, the "0 total" and the view chips all go with it: a zero and a
    // "Topic approved" chip standing over the explanation would keep saying the
    // list is empty for the reasons it is not.
    expect(screen.queryByTestId('table-records-draft')).toBeNull();
    expect(screen.getByTestId('record-count').textContent).toBe('— total');
    expect(screen.queryByText('Showing:')).toBeNull();
  });

  it('holding a scope with nothing of this type: says so without naming rows it cannot see', async () => {
    probe.access = ONE_SCOPE;
    probe.readableCount = 0;
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelector('[data-scope-absence="other-scope"]')).toBeTruthy(),
    );
    expect(screen.getAllByText(/\/ogmc-agent-test/).length).toBeGreaterThan(0);
    // It knows the scopes the reader holds and NOTHING about what is filed
    // elsewhere. Naming the other side would be a new bug wearing this one's fix.
    expect(container.textContent).not.toContain('/ogmc,');
  });

  it('holding a scope WITH rows: the table stands, plus the standing "scoped view" line', async () => {
    probe.access = ONE_SCOPE;
    probe.readableCount = 4;
    const { container } = renderPage();

    const table = await screen.findByTestId('table-records-draft');
    await waitFor(() => expect(table.dataset.loading).toBe('false'));
    expect(container.querySelector('[data-scope-absence]')).toBeNull();
    // "4 total" over a corpus of 160 is TRUE and unreadable on its own. The
    // line is what makes it legible, and it is the commonest scoped reading by
    // far — the Absence above fires only when the reader can reach nothing.
    expect(container.querySelector('[data-scope-notice="narrowed"]')).toBeTruthy();
    expect(screen.getByText(/Counts and rows here cover \/ogmc-agent-test only/)).toBeInTheDocument();
  });

  it('on a tenant that gates nothing, nothing changes at all', async () => {
    probe.access = null;
    probe.readableCount = 4;
    const { container } = renderPage();

    await screen.findByTestId('table-records-draft');
    expect(container.querySelector('[data-scope-absence]')).toBeNull();
    expect(container.querySelector('[data-scope-notice]')).toBeNull();
  });
});
