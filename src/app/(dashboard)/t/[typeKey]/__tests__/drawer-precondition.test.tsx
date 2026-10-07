/**
 * A SAVE FROM THE TOPIC DRAWER ASSERTS THE VERSION OF THE BLOB IT MERGED ONTO
 * (bd startsim-jkkn7.19).
 *
 * The drawer holds `selected`, a snapshot taken when the row was clicked. The
 * version registry (lib/record-version.ts) holds whatever the LAST read said, and
 * every list refetch moves it. Before this bead "Edit fields" merged onto the
 * snapshot and asserted the registry, so a refetch between opening the drawer and
 * pressing Save made a stale blob look current and the server accepted it.
 *
 * WHY THIS RUNS AT THE PAGE, OVER A FAKE TENANT. Each failure here is a property
 * of the WIRING between the page's `selected`, the shared drawer's own `data` and
 * the registry, and each is silent: the request is a 200. So the real page, the
 * real shared `ReviewDrawer`, the real `RecordEditFields`, the real
 * `foundry-api` and the real registry are all under test, and only the transport
 * (`@/lib/api`) is replaced — by a tenant that enforces `If-Match` the way
 * `apps/api/preconditions.enforce` does and replaces `data` wholesale. The
 * assertions read what that tenant ends up STORING.
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
  return screen.findByRole('button', { name: /edit fields/i });
}

async function editTitleAndSave(title: string) {
  fireEvent.click(screen.getByRole('button', { name: /edit fields/i }));
  const field = await screen.findByDisplayValue(String(served().data.title));
  fireEvent.change(field, { target: { value: title } });
  const before = patches.length;
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(patches.length).toBeGreaterThan(before));
  // Let the form's own follow-up (invalidate, onSaved) settle.
  await new Promise((r) => setTimeout(r, 20));
}

async function saveNote(text: string) {
  fireEvent.click(screen.getByRole('button', { name: /add note|note ✓/i }));
  fireEvent.change(await screen.findByPlaceholderText(/why\?/i), { target: { value: text } });
  const before = patches.length;
  fireEvent.click(screen.getByRole('button', { name: /save note/i }));
  await waitFor(() => expect(patches.length).toBeGreaterThan(before));
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(() => {
  db.version = 3;
  db.name = 'qatar-customs (record name)';
  db.data = {
    title: 'Qatar customs clearance timelines',
    angle: 'the reviewer angle',
    status: 'suggested',
    team_notes: '',
  };
  patches.length = 0;
  notify.success.mockClear();
  notify.error.mockClear();
  resetHeldVersions();
  resetDeclaredAliasIndex();
  global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
});

describe('Edit fields in the topic drawer', () => {
  it('does not overwrite an edit that landed after the drawer opened, even once the list refetched', async () => {
    renderPage();
    await openDrawer();

    // Somebody else rewrites the angle (v3 -> v4), and this table refetches —
    // which moves the registry to v4 while the drawer still holds v3's blob.
    otherWriter({ angle: 'THEIR angle' });
    await listRefetch();

    await editTitleAndSave('My new title');

    // Refused, or kept. Never silently erased.
    expect(db.data.angle).toBe('THEIR angle');
    // And it was the precondition that did it: the request asserted the version
    // of the blob it carried, v3, not the v4 the refetch had seen.
    expect(patches.at(-1)).toMatchObject({ ifMatch: '"3"', status: 412 });
    expect(notify.error).toHaveBeenCalled();
  });

  it('keeps a decision this reviewer just made in the same drawer', async () => {
    renderPage();
    await openDrawer();

    await saveNote('angle too broad');
    expect(db.data.team_notes).toBe('angle too broad');

    await editTitleAndSave('My new title');

    // Saved — the reviewer's own note is not a conflict — and the note survives.
    expect(patches.at(-1)?.status).toBe(200);
    expect(db.data.title).toBe('My new title');
    expect(db.data.team_notes).toBe('angle too broad');
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('is not undone by the next decision made in the same drawer', async () => {
    renderPage();
    await openDrawer();

    await editTitleAndSave('My new title');
    expect(db.data.title).toBe('My new title');

    await saveNote('fine now');

    expect(patches.at(-1)?.status).toBe(200);
    expect(db.data.team_notes).toBe('fine now');
    expect(db.data.title).toBe('My new title');
  });

  it('moves the drawer to the saved version, so its History card reads the new trail', async () => {
    renderPage();
    await openDrawer();
    expect(screen.getByTestId('history-version').textContent).toBe('v3');

    await editTitleAndSave('My new title');

    await waitFor(() => expect(screen.getByTestId('history-version').textContent).toBe('v4'));
    // and the drawer reads the saved title, not the snapshot it opened on
    expect(within(screen.getByRole('complementary')).getAllByText('My new title').length).toBeGreaterThan(0);
  });

});

/**
 * THE HALF THIS APP CANNOT CLOSE — bd startsim-jkkn7.20, in @startsimpli/ui.
 *
 * The shared drawer's decisions (approve, reject, the note, the status override)
 * merge over the drawer's OWN `data` and write through the two-argument
 * `CollectionClient.updateEntity(id, input)`, which has no room for a
 * precondition — so the registry supplies it, and a refetch has moved that past
 * the blob. `it.fails` because it reproduces today: when the shared drawer
 * carries its base version and this app is bumped onto it, this starts FAILING,
 * which is the cue to drop `.fails` and keep it as a plain test.
 */
describe('a decision in the topic drawer', () => {
  it.fails('does not overwrite an edit that landed after the drawer opened (ui: startsim-jkkn7.20)', async () => {
    renderPage();
    await openDrawer();

    otherWriter({ angle: 'THEIR angle' });
    await listRefetch();

    await saveNote('a note made after the refetch');

    expect(db.data.angle).toBe('THEIR angle');
  });
});
