/**
 * The Topics table, as the 2026-10-18 design review left it (epic startsim-cxtgr).
 *
 *  - Row decisions follow the record's permissions, as the drawer does
 *    (bd startsim-m7fdm.32): a "Can view" reader sees the state, not buttons.
 *  - The heading is "Topics"; a kind page is headed and labelled by the kind,
 *    with no Kind column repeating it (startsim-5nbpj, startsim-jn6cx).
 *  - Kind chips and cells read as the sidebar names them (startsim-y78xg).
 *  - Add topic on a kind page starts as that kind (startsim-0mshp).
 *  - An empty topic table says so once, in plain words (startsim-s6yxr).
 *
 * The real page over a fake tenant (the drawer-reader.test.tsx harness); the
 * table stub draws each row's cells so the real columns are exercised.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { EntityRecord } from '@/lib/foundry-api';

const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

// ── the tenant ──────────────────────────────────────────────────────────────

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 1, name: 'title', dataType: 'text', required: false, config: {} },
    { id: 2, name: 'angle', dataType: 'longtext', required: false, config: {} },
    {
      id: 4,
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
    },
    { id: 5, name: 'team_verdict', dataType: 'text', required: false, config: {} },
    { id: 6, name: 'team_notes', dataType: 'longtext', required: false, config: {} },
    {
      id: 7,
      name: 'content_type',
      dataType: 'enum',
      required: false,
      config: { choices: ['weekly_brief', 'lead_magnet', 'general'] },
    },
  ],
};

/** How many rows the tenant holds (0 = an empty workspace). */
const rows = { n: 1 };

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const mapKeys = (o: Record<string, unknown>, f: (k: string) => string) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));

/** What the tenant has stored: snake_case, as Django keeps it. */
const db = {
  version: 3,
  name: 'qatar-customs (record name)',
  data: {} as Record<string, unknown>,
};

/** The reader's share on the topic. */
const share = { canEdit: true };

/** Every PATCH the tenant received, and what it said. */
const patches: { ifMatch?: string; data: Record<string, unknown>; status: number }[] = [];

/** The row as the shared client hands it to the app: camelCased inside `data`. */
function served(): EntityRecord {
  return {
    id: 'topic-1',
    entityType: 'topic',
    externalId: null,
    name: db.name,
    data: mapKeys(db.data, camel),
    createdAt: '2026-09-20T00:00:00Z',
    version: db.version,
    permissions: { canEdit: share.canEdit },
  } as unknown as EntityRecord;
}


const page = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

vi.mock('@/lib/api', () => ({
  APP_SLUG: 'marketing-agents',
  resolveAppSlug: () => 'marketing-agents',
  signinUrl: () => '/signin',
  api: {
    client: {
      get: vi.fn(async (path: string) => {
        if (path === 'api/v1/schema/types') return page([TOPIC_TYPE]);
        if (path === 'api/v1/whoami') return { sub: 'u1', role: 'member' };
        if (path === 'api/v1/entities/topic-1') return served();
        if (path.startsWith('api/v1/entities')) return page(rows.n ? [served()] : []);
        return page([]);
      }),
      patch: vi.fn(
        async (
          path: string,
          body: { name?: string; data?: Record<string, unknown> },
          opts?: { headers?: Record<string, string> },
        ) => {
          if (path !== 'api/v1/entities/topic-1') throw new Error(`unexpected PATCH ${path}`);
          const ifMatch = opts?.headers?.['If-Match'];
          if (ifMatch !== undefined && ifMatch !== `"${db.version}"`) {
            patches.push({ ifMatch, data: body.data ?? {}, status: 412 });
            throw new Error(`This record changed since you opened it (now version ${db.version}).`);
          }
          patches.push({ ifMatch, data: body.data ?? {}, status: 200 });
          // REPLACES `data`, as the tenant does. Keys arrive already re-keyed to
          // the declared names by `wireSafeData`; the rest is the client's job.
          if (body.data) db.data = mapKeys(body.data, snake);
          if (body.name) db.name = body.name;
          db.version += 1;
          return served();
        },
      ),
      post: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
  },
}));

// ── the page's surroundings ─────────────────────────────────────────────────

interface TableStubProps {
  tableId?: string;
  data?: EntityRecord[];
  columns?: { id: string; header?: string; cell?: (row: EntityRecord) => ReactNode }[];
  emptyState?: ReactNode;
  filters?: { config: { sections: { filters?: { id: string; options?: string[]; optionLabels?: Record<string, string> }[] }[] } };
  pagination?: { enabled?: boolean };
}

const tableProps: { last?: TableStubProps } = {};

// Each row draws every column's real cell; the props are kept for the asserts.
vi.mock('@startsimpli/ui', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<typeof import('@startsimpli/ui')>();
  return {
    ...actual,
    UnifiedTable: (props: TableStubProps) => {
      if (props.tableId === 'records-topic') tableProps.last = props;
      const data = props.data ?? [];
      return React.createElement(
        'div',
        { 'data-testid': `table-${props.tableId}` },
        React.createElement(
          'div',
          { 'data-testid': 'headers' },
          (props.columns ?? []).map((c) => React.createElement('span', { key: c.id }, c.header ?? '')),
        ),
        data.length === 0 ? props.emptyState : null,
        data.map((row) =>
          React.createElement(
            'div',
            { key: String(row.id), 'data-testid': `row-${row.id}` },
            (props.columns ?? []).map((c) =>
              React.createElement('div', { key: c.id, 'data-testid': `cell-${c.id}` }, c.cell?.(row)),
            ),
          ),
        ),
      );
    },
    notify,
  };
});

// The real form and the real drawer. Only the topic extras are replaced, by a
// line that prints the version the drawer is showing — that version is what the
// History card is keyed on (lib/entity-cache.ts `revisionsKey`), and the card
// itself is pinned in components/__tests__/record-history-surfaces.test.tsx.
vi.mock('@/components/entity-detail-drawer', async () => {
  const React = await import('react');
  const actual = await vi.importActual<typeof import('@/components/entity-detail-drawer')>(
    '@/components/entity-detail-drawer',
  );
  return {
    ...actual,
    TopicReviewExtra: ({ record }: { record: EntityRecord }) =>
      React.createElement('p', { 'data-testid': 'history-version' }, `v${record.version}`),
  };
});
const formProps: { last?: { defaults?: Record<string, unknown> } } = {};
vi.mock('@/components/record-form', () => ({
  RecordForm: (props: { defaults?: Record<string, unknown> }) => {
    formProps.last = props;
    return null;
  },
}));
vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: vi.fn(async () => 'test.token.value') }));
vi.mock('@startsimpli/auth', () => ({ useAuth: () => ({ user: { email: 'qa+ma@startsimpli.com' } }) }));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ children, href }: { children?: ReactNode; href?: string }) =>
      React.createElement('a', { href }, children),
  };
});
const search = { qs: '' };
vi.mock('next/navigation', () => ({
  useParams: () => ({ typeKey: 'topic' }),
  useSearchParams: () => new URLSearchParams(search.qs),
  usePathname: () => '/t/topic',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const { resetHeldVersions } = await import('@/lib/record-version');
const { resetDeclaredAliasIndex } = await import('@/lib/foundry-api');
const TypeRecordsPage = (await import('../page')).default;

let qc: QueryClient;

function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TypeRecordsPage />
    </QueryClientProvider>,
  );
}



beforeEach(() => {
  resetHeldVersions();
  resetDeclaredAliasIndex();
  patches.length = 0;
  db.version = 3;
  db.data = { title: 'Qatar customs', status: 'ready', content_type: 'lead_magnet' };
  share.canEdit = true;
  rows.n = 1;
  search.qs = '';
  tableProps.last = undefined;
  formProps.last = undefined;
});


describe('Topics table rows and the reader\'s share', () => {
  it('a "Can view" reader sees the row\'s state, not Reject / Approve / Needs work', async () => {
    share.canEdit = false;
    renderPage();
    const row = await screen.findByTestId('row-topic-1');
    const decision = within(row).getByTestId('cell-__actions');
    expect(within(decision).queryByRole('button')).toBeNull();
    expect(within(decision).getByText('ready')).toBeInTheDocument();
  });

  it('someone who can edit still gets the three decisions', async () => {
    renderPage();
    const row = await screen.findByTestId('row-topic-1');
    const decision = within(row).getByTestId('cell-__actions');
    expect(within(decision).getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(within(decision).getByRole('button', { name: /reject/i })).toBeInTheDocument();
  });
});

describe('Topics heading, kinds and Add topic', () => {
  it('is headed Topics and names kinds the way the sidebar does', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Topics' })).toBeInTheDocument();
    const row = await screen.findByTestId('row-topic-1');
    expect(within(row).getByTestId('cell-content_type')).toHaveTextContent('Evergreen');
    const kind = tableProps.last?.filters?.config.sections[0].filters?.[0];
    expect(kind?.options).toEqual(['weekly_brief', 'lead_magnet', 'general']);
    expect(kind?.optionLabels).toMatchObject({ weekly_brief: 'Weekly Briefs', lead_magnet: 'Evergreen' });
    fireEvent.click(screen.getByRole('button', { name: /add topic/i }));
    await waitFor(() => expect(formProps.last).toBeDefined());
    expect(formProps.last?.defaults).toBeUndefined();
  });

  it('a kind page has no Kind column and Add topic starts as that kind', async () => {
    search.qs = 'content_type=lead_magnet';
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Evergreen' })).toBeInTheDocument();
    await screen.findByTestId('row-topic-1');
    expect(within(screen.getByTestId('headers')).queryByText('Kind')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /add topic/i }));
    await waitFor(() => expect(formProps.last?.defaults).toEqual({ content_type: 'lead_magnet' }));
  });
});

describe('an empty topic table', () => {
  it('says "No topics yet." once, with no "No items" footer', async () => {
    rows.n = 0;
    renderPage();
    expect(await screen.findByText('No topics yet.')).toBeInTheDocument();
    await waitFor(() => expect(tableProps.last?.pagination?.enabled).toBe(false));
  });

  it('on a kind page names the kind', async () => {
    rows.n = 0;
    search.qs = 'content_type=weekly_brief';
    renderPage();
    expect(await screen.findByText('No Weekly Briefs topics yet.')).toBeInTheDocument();
  });
});
