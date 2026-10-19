/**
 * The topic drawer draws no write controls for a reader who cannot change the
 * topic (bd startsim-m7fdm.32, review bead startsim-j9agp).
 *
 * Before this, a reader with a "Can view" share was offered the State select,
 * Edit fields, Approve / Needs work / Reject and Add note, and each press ended
 * in "Could not save.". The page now hands the shared drawer the record's own
 * answer. The real page and the real drawer run over a fake tenant (the harness
 * from drawer-precondition.test.tsx); only the record's permissions vary.
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
  ],
};

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

/** Another person's write, landing while this reviewer has the drawer open. */
function otherWriter(changes: Record<string, unknown>) {
  db.data = { ...db.data, ...changes };
  db.version += 1;
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
        if (path.startsWith('api/v1/entities')) return page([served()]);
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
  onRowClick?: (row: EntityRecord) => void;
}

// A row is a button that opens the drawer, and `notify` is observable. The rest
// of the shared barrel is the real thing.
vi.mock('@startsimpli/ui', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<typeof import('@startsimpli/ui')>();
  return {
    ...actual,
    UnifiedTable: (props: TableStubProps) =>
      React.createElement(
        'div',
        { 'data-testid': `table-${props.tableId}` },
        (props.data ?? []).map((row) =>
          React.createElement(
            'button',
            { key: String(row.id), 'data-testid': `row-${row.id}`, onClick: () => props.onRowClick?.(row) },
            row.name,
          ),
        ),
      ),
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
vi.mock('@/components/record-form', () => ({ RecordForm: () => null }));
vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: vi.fn(async () => 'test.token.value') }));
vi.mock('@startsimpli/auth', () => ({ useAuth: () => ({ user: { email: 'qa+ma@startsimpli.com' } }) }));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ children, href }: { children?: ReactNode; href?: string }) =>
      React.createElement('a', { href }, children),
  };
});
vi.mock('next/navigation', () => ({
  useParams: () => ({ typeKey: 'topic' }),
  useSearchParams: () => new URLSearchParams(''),
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

/** The table refetches — after a save on ANOTHER row, a filter change, anything. */
async function listRefetch() {
  await qc.invalidateQueries({ queryKey: ['entities', 'topic'] });
}

async function openDrawer() {
  fireEvent.click(await screen.findByTestId('row-topic-1'));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  resetHeldVersions();
  resetDeclaredAliasIndex();
  patches.length = 0;
  db.version = 3;
  db.data = { title: 'Qatar customs', status: 'suggested' };
});

describe('the topic drawer and the reader\'s share', () => {
  it('a "Can view" reader gets no State select, Edit fields, decisions or Add note', async () => {
    share.canEdit = false;
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).getByText('Qatar customs')).toBeInTheDocument();
    expect(within(drawer).queryByRole('combobox')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: /edit fields/i })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: /approve/i })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: /reject/i })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: /add note/i })).toBeNull();
    expect(within(drawer).getByText('You can view this topic.')).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it('someone who can edit the topic still gets every control', async () => {
    share.canEdit = true;
    renderPage();
    const drawer = await openDrawer();

    expect(await within(drawer).findByRole('button', { name: /edit fields/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('combobox')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /add note/i })).toBeInTheDocument();
  });
});
