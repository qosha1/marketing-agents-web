/**
 * "All clear" has to mean all clear (bd startsim-tkfzu).
 *
 * FOUND IN THE BROWSER 2026-10-05 on the deployed marketing-agents tenant: the
 * Dashboard's "What needs a human" card read `All clear — nothing is waiting on
 * a person` while drafts sat at `ready_for_review` in the same scope. Over the
 * live corpus that was 166 of 169 drafts. `QUEUE_ROWS` carried two TOPIC
 * predicates and nothing on the Dashboard counted a draft at all, so with every
 * topic judged and filed the card rendered its all-clear and was wrong.
 *
 * It compounded with the Drafts tab's deliberate 7-day window: a draft nobody
 * reviewed inside a week left that tab AND had never been on the Dashboard, so
 * from day eight no default surface mentioned it — while the Dashboard reported
 * the result as nothing to do.
 *
 * This file renders the widget against the live shape rather than asserting on
 * the pure helpers alone, because the defect was not in a predicate: every
 * predicate was right about its own subject. It was in what the card fetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityRecord, EntityTypeDef, MemberRow } from '@/lib/foundry-api';

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    {
      id: 10,
      name: 'status',
      dataType: 'enum',
      config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
    },
  ],
} as unknown as EntityTypeDef;

const DRAFT_TYPE = {
  id: 2,
  key: 'draft',
  label: 'Draft',
  attributes: [
    {
      id: 20,
      name: 'status',
      dataType: 'enum',
      // The eleven values the live type declares (read 2026-10-05).
      config: {
        choices: [
          'ready_for_review', 'under_review', 'approved', 'published', 'rejected',
          'not_for_publication', 'for_repurpose', 'drafting', 'ready', 'needs_revision', 'sent',
        ],
      },
    },
  ],
} as unknown as EntityTypeDef;

/** Every topic judged AND filed — so the topic queue is legitimately empty. */
const TOPICS: EntityRecord[] = [
  { id: 'T1', name: 'UAE fee reform', data: { status: 'written', team_verdict: 'good' }, createdAt: '2026-09-01' },
  { id: 'T2', name: 'Oman e-invoicing', data: { status: 'rejected', team_verdict: 'bad' }, createdAt: '2026-09-01' },
] as unknown as EntityRecord[];

/** The live sandbox shape: undecided drafts, one of them ours. */
const DRAFTS: EntityRecord[] = [
  { id: 'D1', name: 'a', data: { status: 'ready_for_review' }, ownerSub: 'svc:n8n-ogmc', createdAt: '2026-09-17' },
  { id: 'D2', name: 'b', data: { status: 'ready_for_review' }, ownerSub: 'svc:n8n-ogmc', createdAt: '2026-09-17' },
  { id: 'D3', name: 'c', data: { status: 'under_review' }, ownerSub: 'svc:n8n-ogmc', createdAt: '2026-09-20' },
  {
    id: 'D4', name: 'ours',
    data: { status: 'ready_for_review', _triggered_by: 'qa+ma@startsimpli.com' },
    ownerSub: 'svc:n8n-ogmc', createdAt: '2026-09-17',
  },
  { id: 'D5', name: 'done', data: { status: 'approved' }, ownerSub: 'svc:n8n-ogmc', createdAt: '2026-09-17' },
] as unknown as EntityRecord[];

const MEMBERS: MemberRow[] = [
  { id: 1, user: { sub: 'sub-qa', email: 'qa-marketing-agents@startsimpli.com' }, role: 'admin' },
];

/** Flipped per test — a member-role reader's roster read is refused. */
let ROSTER_REFUSED = true;
/** Flipped per test — the "nothing waiting anywhere" case. */
let DRAFT_ROWS: EntityRecord[] = DRAFTS;

vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ results: [TOPIC_TYPE, DRAFT_TYPE] })),
  listAllEntities: vi.fn(async (typeKey: string) => (typeKey === 'topic' ? TOPICS : DRAFT_ROWS)),
  listEntities: vi.fn(async () => ({ count: 0, results: [], next: null })),
  orgMembers: vi.fn(async () => {
    if (ROSTER_REFUSED) throw new Error('Request failed with status 403');
    return MEMBERS;
  }),
}));

import { AttentionWidget } from '@/components/dashboard/widgets';

beforeEach(() => {
  ROSTER_REFUSED = true;
  DRAFT_ROWS = DRAFTS;
});

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AttentionWidget />
    </QueryClientProvider>,
  );
}

describe('the "what needs a human" card counts drafts', () => {
  it('does NOT say all clear while drafts sit undecided', async () => {
    renderWidget();
    await waitFor(() =>
      expect(screen.getByText(/Awaiting a review decision/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/All clear/i)).toBeNull();
    expect(screen.queryByText(/nothing is waiting on a person/i)).toBeNull();
  });

  it('states the count in drafts, and leaves OUR test drafts out of it', async () => {
    renderWidget();
    // D1, D2, D3 wait. D4 names a platform address on the row, so the same gate
    // the Drafts table applies drops it; D5 is approved.
    expect(await screen.findByText('Awaiting a review decision — 3 drafts')).toBeInTheDocument();
  });

  it('says how long the oldest has waited, and why it is not on the Drafts tab', async () => {
    renderWidget();
    await screen.findByText(/Awaiting a review decision/i);
    expect(screen.getByText(/ready for review 2/i)).toBeInTheDocument();
    expect(screen.getByText(/last 7 days/i)).toBeInTheDocument();
  });

  it('links to the drafts table with the gates that would hide them cleared', async () => {
    renderWidget();
    await screen.findByText(/Awaiting a review decision/i);
    const link = screen.getByRole('link', { name: /Awaiting a review decision/i });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/t/draft');
    expect(href).toContain('queue=drafts-awaiting-decision');
    expect(href).toContain('topic=all');
    expect(href).toContain('since=all');
    // Not `made=all`: the count applied that gate too.
    expect(href).not.toContain('made=');
  });

  it('badges a total it can stand behind, in no particular record kind', async () => {
    renderWidget();
    await screen.findByText(/Awaiting a review decision/i);
    // It used to read "N topics waiting" — a claim the number is not once
    // drafts are in it.
    expect(screen.getByText('3 waiting')).toBeInTheDocument();
    expect(screen.queryByText(/3 topics waiting/i)).toBeNull();
  });

  it('still says all clear when nothing anywhere is waiting', async () => {
    DRAFT_ROWS = [DRAFTS[4]];
    renderWidget();
    expect(await screen.findByText(/All clear — nothing is waiting on a person/i)).toBeInTheDocument();
  });

  it('renders the queue even though the roster read was refused', async () => {
    // The card must not treat a 403 on the member list as a failed widget: that
    // would blank the Dashboard for every member-role reviewer.
    renderWidget();
    await screen.findByText(/Awaiting a review decision/i);
    expect(screen.queryByText(/Couldn’t load this data/i)).toBeNull();
  });

  it('with a readable roster, drops the drafts owned by a platform account too', async () => {
    ROSTER_REFUSED = false;
    DRAFT_ROWS = [
      ...DRAFTS,
      { id: 'D6', name: 'ours-by-owner', data: { status: 'ready_for_review' }, ownerSub: 'sub-qa', createdAt: '2026-09-17' } as unknown as EntityRecord,
    ];
    renderWidget();
    expect(await screen.findByText('Awaiting a review decision — 3 drafts')).toBeInTheDocument();
  });
});
