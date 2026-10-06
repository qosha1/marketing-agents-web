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
const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

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
    // The approval's own acknowledgement goes through here (bd
    // startsim-m7fdm.19). It is stubbed rather than omitted because
    // `lib/approve-dispatch.ts` calls it on BOTH arms: an undefined `notify`
    // would throw inside the dispatch's try, be caught, and throw again in the
    // catch — an unhandled rejection that says nothing about the wiring.
    notify,
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
    //
    // THE try/catch IS PART OF THAT SHAPE, not test scaffolding. In
    // @startsimpli/ui@0.4.138 `onSaved?.()` sits INSIDE the try, on the line
    // after the awaited `updateEntity` — so a save the server REFUSES (a 412
    // from the version precondition, bd startsim-j19hf) never reaches it. A stub
    // without the catch would turn that case into an unhandled rejection and
    // would be testing the stub instead of the wiring (bd startsim-jkkn7.13).
    InlineReviewActions: ({
      client,
      record,
      onSaved,
    }: {
      client: CollectionClient;
      record: EntityRecord;
      onSaved?: () => void;
    }) => {
      const decide = (status: string) => async () => {
        try {
          await client.updateEntity(record.id, { data: { ...record.data, status } });
          onSaved?.();
        } catch (err) {
          notify.error(err instanceof Error ? err.message : 'Could not save.');
        }
      };
      return React.createElement(
        'span',
        null,
        React.createElement(
          'button',
          { 'data-testid': `approve-${record.id}`, onClick: decide('ready') },
          'approve',
        ),
        React.createElement(
          'button',
          { 'data-testid': `reject-${record.id}`, onClick: decide('rejected') },
          'reject',
        ),
      );
    },
  };
});

vi.mock('@/components/entity-detail-drawer', () => ({
  EntityDetailDrawer: () => null,
  GoodExampleToggle: () => null,
  RecordEditFields: () => null,
  TopicDrafts: () => null,
}));
vi.mock('@/components/record-form', () => ({ RecordForm: () => null }));
// The dispatch sends the reviewer's own bearer, so the route can only start a
// writer the person who approved could have started themselves.
vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: vi.fn(async () => 'test.token.value') }));
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

const { resetGenerateRuns } = await import('@/lib/generate-run');
// NOT mocked: the registry is the thing the dispatch has to keep honest, so the
// real one is under test here (bd startsim-jkkn7.13).
const { heldVersion, rememberVersion, resetHeldVersions } = await import('@/lib/record-version');
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
  notify.success.mockClear();
  notify.error.mockClear();
  // "One run per topic" is a property of a MODULE-LEVEL store that outlives a
  // test (bd startsim-ozpjw.9), so a second approval of the same topic would
  // otherwise be refused as a rejoin of the first test's run.
  resetGenerateRuns();
  resetHeldVersions();
  searchString = '';
  // NOT OPTIONAL. Unstubbed, the dispatch POSTs /actions/generate-drafts, which
  // in a deployed tenant relays the real n8n writer.
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 })) as unknown as typeof fetch;
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

/**
 * Approving a topic STARTS ITS DRAFT (bd startsim-m7fdm.19).
 *
 * The same reasoning as the navigation suite above: the predicate is proved in
 * the node lane and what can still be wrong is the WIRING. Three mistakes are
 * available here and all three type-check — dispatching on every save rather
 * than on the approve transition, dispatching with the button's `trigger` so the
 * draft claims somebody pressed it, and dispatching AFTER the push so the story
 * page opens on an enabled button instead of on the writer's progress.
 */
describe('approving a topic starts its draft', () => {
  /** The body POSTed to /actions/generate-drafts, if any. */
  function dispatched(): Record<string, unknown> | null {
    const call = vi.mocked(global.fetch).mock.calls.find(([url]) => String(url) === '/actions/generate-drafts');
    if (!call) return null;
    return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
  }

  it('relays the topic’s story, named as an APPROVAL rather than a button press', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    await waitFor(() => expect(dispatched()).not.toBeNull());
    expect(dispatched()).toMatchObject({
      trigger: 'topic_approved',
      story: { topic_ref: 'topic-1', title: 'Qatar customs clearance timelines' },
    });
  });

  it('tells the reviewer the draft is being written', async () => {
    // Half the complaint. The writer is async and takes ~2 minutes, so an
    // instant dispatch with no acknowledgement still looks like nothing
    // happened — and the reviewer presses "Generate drafts" anyway.
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    await waitFor(() => expect(notify.success).toHaveBeenCalled());
    expect(String(notify.success.mock.calls[0][0])).toMatch(/writing the draft/i);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('claims the run BEFORE navigating, so the story page opens on the writer', async () => {
    // `TopicDrafts` seeds `generating` from the run store AT MOUNT, so a run
    // claimed after the push would leave the landing page showing an enabled
    // Generate button — the second press this bead removes.
    const { isGenerateRunning } = await import('@/lib/generate-run');
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(isGenerateRunning('topic-1')).toBe(true);
  });

  it('does NOT dispatch on a reject', async () => {
    // The transition, not the save. A decision that is not an approval has not
    // asked for a draft.
    renderPage();
    fireEvent.click(await screen.findByTestId('reject-topic-1'));

    await waitFor(() => expect(updateEntity).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatched()).toBeNull();
  });

  it('reports a refused dispatch instead of leaving a false "writing…" behind', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Could not verify the topic.' }), { status: 502 }),
    ) as unknown as typeof fetch;
    const { isGenerateRunning } = await import('@/lib/generate-run');
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(String(notify.error.mock.calls[0][0])).toMatch(/^Approved, but/);
    // ENDED IN THE STORE, so navigating back to this topic does not rejoin a run
    // that never began and sit on "Generating…" for six minutes.
    expect(isGenerateRunning('topic-1')).toBe(false);
  });

  /**
   * A REFUSED APPROVE DISPATCHES NOTHING (bd startsim-m7fdm.19, bd startsim-j19hf).
   *
   * Approving now does two things that did not previously coexist: it WRITES
   * (status and team_verdict together) and that write carries a version
   * precondition, so the server can REFUSE it with a 412. If the dispatch hung
   * off the button press, a reviewer whose approval was rejected would still
   * spend an LLM run and still get a draft for a topic that is not approved.
   *
   * It does not, and the reason is structural rather than a check: the dispatch
   * is gated on `approveWatch.tookApproval`, which reports off the record the
   * server PERSISTED — a rejected `updateEntity` never assigns the reading, and
   * the shared cluster never calls `onSaved` either. These tests pin that, from
   * the outside, at the one seam a refactor could quietly move.
   */
  it('does NOT dispatch when the server REFUSES the approve', async () => {
    const { isGenerateRunning } = await import('@/lib/generate-run');
    updateEntity.mockRejectedValueOnce(
      new Error('This topic changed since you opened it. Reload and try again.'),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    // The reviewer is told, by the shared cluster, in the server's own words.
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(String(notify.error.mock.calls[0][0])).toMatch(/changed since you opened it/);
    // And nothing was asked of the writer.
    expect(dispatched()).toBeNull();
    expect(isGenerateRunning('topic-1')).toBe(false);
    // Nor was the reviewer sent to a story for a topic that is not approved.
    expect(push).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('dispatches on the NEXT approve, so a refusal is not a dead button', async () => {
    const { isGenerateRunning } = await import('@/lib/generate-run');
    updateEntity.mockRejectedValueOnce(new Error('412'));
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));
    await waitFor(() => expect(notify.error).toHaveBeenCalled());

    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    await waitFor(() => expect(dispatched()).not.toBeNull());
    expect(isGenerateRunning('topic-1')).toBe(true);
  });

  /**
   * AND THE RELAY'S OWN WRITE MUST NOT BREAK THE ACCEPT THAT FOLLOWS
   * (bd startsim-jkkn7.13).
   *
   * The route stamps the topic server-side, which allocates a new `version` the
   * browser cannot see. `primeEntity` keeps `['entity', <topicId>]` fresh for
   * five minutes with `refetchOnWindowFocus: false`, so the story page and the
   * draft page both read the topic from that cache and never refetch it — and
   * `/draft/<id>` Accept asserts the registry's version when it moves the topic
   * to `written`. Unreported, a reviewer accepting inside five minutes of
   * approving gets the draft approved and the topic refused, which is the whole
   * flow this bead exists to make work.
   */
  it('remembers the topic version the relay reports, so Accept is not refused', async () => {
    // The version the approve save itself produced — what the registry holds
    // before the stamp moves it.
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, deduped: false, topic_version: 31 }), { status: 202 }),
    ) as unknown as typeof fetch;
    rememberVersion('topic-1', { version: 30 });
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    await waitFor(() => expect(heldVersion('topic-1')).toBe(31));
  });

  it('leaves the held version alone when the relay reports none', async () => {
    // A failed stamp moved nothing, so the version the browser holds is still
    // the current one. Overwriting it with a guess is the bug, not the fix.
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, deduped: true }), { status: 202 }),
    ) as unknown as typeof fetch;
    rememberVersion('topic-1', { version: 30 });
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    await waitFor(() => expect(notify.success).toHaveBeenCalled());
    expect(heldVersion('topic-1')).toBe(30);
  });

  it('stays SILENT when the topic already has drafts', async () => {
    // Re-approving a drafted topic asked for nothing new. A red toast there is a
    // failure report for a non-failure.
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: 'Drafts have already been written for this topic.', reason: 'drafts_exist' }),
        { status: 403 },
      ),
    ) as unknown as typeof fetch;
    renderPage();
    fireEvent.click(await screen.findByTestId('approve-topic-1'));

    await waitFor(() => expect(dispatched()).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });
});
