/**
 * EVERY SURFACE THAT EDITS A RECORD SHOWS ITS HISTORY (bd startsim-jkkn7.16).
 *
 * Until this bead only the draft page's rail mounted the shared
 * `RecordHistoryPanel`. A reviewer could change a topic's title, angle, note,
 * status or verdict from four places — the topic header on /story and /draft,
 * the topic review drawer on /t/topic, and the generic record drawer on every
 * other table and on the board — and see who changed it from none of them. Those
 * are exactly the fields the machine-overwrites-human incidents hit.
 *
 * What is pinned here is the WIRING, per surface, because each mount is a
 * separate line that type-checks whether or not it is there:
 *
 *  1. the panel is reachable from the surface, collapsed until asked for (the
 *     panel fetches on mount, and a drawer opened per row must not cost a
 *     request per row nobody expanded);
 *  2. it reads THIS record's trail, through this app's raw-fetch reader — so the
 *     tenant's declared field names arrive verbatim (`team_verdict`, never
 *     `teamVerdict`);
 *  3. the trail is keyed on the record's VERSION, so a save made on the same
 *     surface is visible on the next look rather than after QueryProvider's
 *     five-minute staleTime.
 *
 * The panel itself — actor vocabulary, folding, 404-vs-empty — is tested in
 * packages/ui and not re-tested here.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RevisionPage } from '@startsimpli/ui/history';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: vi.fn(async () => 'test.token.value') }));
vi.mock('@startsimpli/auth', () => ({ useAuth: () => ({ user: { email: 'qa+ma@startsimpli.com' } }) }));
vi.mock('next/link', async () => {
  const R = await import('react');
  return {
    default: ({ children, href }: { children?: React.ReactNode; href?: string }) =>
      R.createElement('a', { href }, children),
  };
});
vi.mock('@/lib/foundry-api', () => ({
  getEntity: vi.fn(async (id: unknown) => ({ id, data: {} })),
  listAllTags: vi.fn(async () => []),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  orgMembers: vi.fn(async () => []),
  listEntities: vi.fn(async () => ({ count: 0, next: null, previous: null, results: [] })),
  listAllEntities: vi.fn(async () => []),
  updateEntity: vi.fn(),
}));

const { EntityDetailDrawer } = await import('../entity-detail-drawer');
const { TopicContextHeader } = await import('../draft-review/TopicContextHeader');

/** One sitting by a named person over a declared snake_case attribute. */
const PAGE: RevisionPage = {
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      id: 'r1',
      version: 3,
      action: 'updated',
      source: 'patch',
      precondition: 'matched',
      created_at: '2026-10-06T08:00:00Z',
      actor_label: 'jurga@ogmc.example',
      actor_kind: 'person',
      actor_kind_source: 'claim',
      metadata: { changed: { team_verdict: { before: 'needs_work', after: 'good' } } },
    },
  ],
};

function revisionCalls(): string[] {
  return vi
    .mocked(global.fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.includes('/revisions'));
}

beforeEach(() => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(PAGE), { status: 200 })) as typeof fetch;
});

function withQuery(node: React.ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { qc, ...render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>) };
}

const NEWS_TYPE = {
  id: 2,
  key: 'news_item',
  label: 'News item',
  attributes: [{ id: 1, name: 'headline', dataType: 'text', required: false, config: {} }],
} as unknown as EntityTypeDef;

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 1, name: 'title', dataType: 'text', required: false, config: {} },
    { id: 2, name: 'angle', dataType: 'longtext', required: false, config: {} },
    {
      id: 3,
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
    },
    { id: 4, name: 'team_notes', dataType: 'longtext', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

function record(id: string, version: number, data: Record<string, unknown> = {}): EntityRecord {
  return { id, entityType: 'x', externalId: null, name: `Record ${id}`, data, version, createdAt: '' } as unknown as EntityRecord;
}

describe('the generic record drawer (board + every non-topic table)', () => {
  it('shows the record’s history, collapsed until asked, over its own trail', async () => {
    withQuery(<EntityDetailDrawer type={NEWS_TYPE} record={record('n-42', 2)} onClose={() => {}} onSaved={() => {}} />);

    const toggle = screen.getByRole('button', { name: /history/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(revisionCalls()).toHaveLength(0);

    fireEvent.click(toggle);
    expect(await screen.findByText('team_verdict')).toBeInTheDocument();
    expect(revisionCalls()[0]).toContain('/api/v1/entities/n-42/revisions?');
  });
});

describe('the topic header (/story and the top of /draft)', () => {
  it('shows the TOPIC’s history, named so it is not mistaken for the draft’s', async () => {
    withQuery(<TopicContextHeader topic={record('topic-1', 3, { title: 'Qatar', status: 'ready' })} type={TOPIC_TYPE} />);

    fireEvent.click(screen.getByRole('button', { name: /topic history/i }));
    expect(await screen.findByText('team_verdict')).toBeInTheDocument();
    expect(revisionCalls()[0]).toContain('/api/v1/entities/topic-1/revisions?');
  });

  it('re-reads the trail when the topic’s version moves, so a save shows up', async () => {
    const qc = new QueryClient({
      // QueryProvider's production defaults — the five minutes a version-blind
      // key would serve the pre-save trail for.
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } },
    });
    const view = withQuery(<TopicContextHeader topic={record('topic-1', 3, { title: 'Qatar' })} type={TOPIC_TYPE} />, qc);
    fireEvent.click(screen.getByRole('button', { name: /topic history/i }));
    await screen.findByText('team_verdict');
    expect(revisionCalls()).toHaveLength(1);

    view.rerender(
      <QueryClientProvider client={qc}>
        <TopicContextHeader topic={record('topic-1', 4, { title: 'Qatar, edited' })} type={TOPIC_TYPE} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(revisionCalls()).toHaveLength(2));
  });
});

describe('the topic review drawer (/t/topic)', () => {
  it('its extra slot carries the topic’s history', async () => {
    const { TopicReviewExtra } = await import('../entity-detail-drawer');
    withQuery(<TopicReviewExtra record={record('topic-9', 5, { status: 'suggested' })} type={TOPIC_TYPE} />);

    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(await screen.findByText('team_verdict')).toBeInTheDocument();
    expect(revisionCalls()[0]).toContain('/api/v1/entities/topic-9/revisions?');
  });
});
