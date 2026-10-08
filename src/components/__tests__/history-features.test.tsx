/**
 * bd startsim-5n9ha + startsim-vehzd — the topic surfaces reach the shared
 * attribution and restore, wired the way this app must wire them.
 *
 *  1. "edited by" reads the RAW field-authors route and a machine-written field
 *     is marked as a machine, beside the field it describes;
 *  2. clicking it opens the topic's history NARROWED to that field (`?field=`);
 *  3. a restore from the topic history asserts the NEWER of the version the host
 *     shows and the one this tab last saw — a drawer snapshot can be older than
 *     the registry — and refreshes the topic's cache afterwards.
 *
 * The components themselves are tested in packages/ui; this pins the wiring.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: vi.fn(async () => 'test.token.value') }));
vi.mock('@startsimpli/auth', () => ({ useAuth: () => ({ user: { email: 'qa+ma@startsimpli.com' } }) }));
vi.mock('next/link', async () => {
  const R = await import('react');
  return {
    default: ({ children, href, className }: { children?: React.ReactNode; href?: string; className?: string }) =>
      R.createElement('a', { href, className }, children),
  };
});
vi.mock('@/lib/foundry-api', () => ({
  getEntity: vi.fn(async (id: unknown) => ({ id, data: {} })),
  listAllTags: vi.fn(async () => []),
  orgMembers: vi.fn(async () => []),
  listEntities: vi.fn(async () => ({ count: 0, next: null, previous: null, results: [] })),
  listAllEntities: vi.fn(async () => []),
  updateEntity: vi.fn(),
}));

const { TopicContextHeader } = await import('../draft-review/TopicContextHeader');
const { rememberVersion, resetHeldVersions } = await import('@/lib/record-version');

const AUTHORS = {
  entity_id: 'topic-1',
  version: 5,
  history: { enabled: true, declared_by: 'default' },
  recorded: true,
  trail_starts: { version: 1, at: '2026-10-01T00:00:00Z', from_creation: false },
  fields: {
    team_verdict: {
      version: 5,
      at: '2026-10-07T10:00:00Z',
      actor_sub: 'svc:n8n-ogmc',
      actor_label: 'svc:n8n-ogmc',
      actor_kind: 'machine',
      actor_kind_source: 'claim',
      source: 'upsert',
    },
    title: {
      version: 4,
      at: '2026-10-07T09:00:00Z',
      actor_sub: 'u-jurga',
      actor_label: 'jurga@ogmc.example',
      actor_kind: 'person',
      actor_kind_source: 'claim',
      source: 'patch',
    },
  },
  name: null,
};

const TRAIL = {
  count: 2,
  next: null,
  previous: null,
  results: [
    {
      id: 'r5',
      version: 5,
      action: 'updated',
      source: 'upsert',
      created_at: '2026-10-07T10:00:00Z',
      actor_sub: 'svc:n8n-ogmc',
      actor_label: 'svc:n8n-ogmc',
      actor_kind: 'machine',
      actor_kind_source: 'claim',
      metadata: { changed: { team_verdict: { before: 'good', after: 'needs_work' } } },
    },
    {
      id: 'r4',
      version: 4,
      action: 'updated',
      source: 'patch',
      created_at: '2026-10-07T09:00:00Z',
      actor_sub: 'u-jurga',
      actor_label: 'jurga@ogmc.example',
      actor_kind: 'person',
      actor_kind_source: 'claim',
      metadata: { changed: { team_verdict: { before: 'needs_work', after: 'good' } } },
    },
  ],
};

type Call = { url: string; method: string; body?: unknown };
let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  resetHeldVersions();
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (url.includes('/field-authors')) return new Response(JSON.stringify(AUTHORS), { status: 200 });
    if (url.includes('/restore'))
      return new Response(
        JSON.stringify({ id: 'topic-1', version: 9, restore: { restored_from: 4, fields: ['team_verdict'], revision: 9 } }),
        { status: 200 },
      );
    return new Response(JSON.stringify(TRAIL), { status: 200 });
  }) as typeof fetch;
});

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 1, name: 'title', dataType: 'text', required: false, config: {} },
    { id: 2, name: 'angle', dataType: 'longtext', required: false, config: {} },
    { id: 3, name: 'status', dataType: 'enum', required: false, config: { choices: ['suggested', 'ready'] } },
    { id: 4, name: 'team_notes', dataType: 'longtext', required: false, config: {} },
    { id: 5, name: 'team_verdict', dataType: 'text', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

function topic(version: number): EntityRecord {
  return {
    id: 'topic-1',
    entityType: 'topic',
    externalId: null,
    name: 'Qatar',
    data: { title: 'Qatar', angle: 'Logistics', status: 'ready', team_verdict: 'needs_work' },
    version,
    createdAt: '',
  } as unknown as EntityRecord;
}

function mount(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>) };
}

describe('topic header — who last wrote each field', () => {
  it('reads the RAW field-authors route and marks the machine-written decision', async () => {
    mount(<TopicContextHeader topic={topic(5)} type={TOPIC_TYPE} />);
    const verdict = await screen.findByTestId('field-attribution-team_verdict');
    expect(within(verdict).getByTestId('actor-kind')).toHaveTextContent(/machine/);
    expect(calls.find((c) => c.url.includes('/field-authors'))?.url).toBe('/api/v1/entities/topic-1/field-authors');
  });

  it('a reviewer’s edit reads their name, unmarked', async () => {
    mount(<TopicContextHeader topic={topic(5)} type={TOPIC_TYPE} />);
    const title = await screen.findByTestId('field-attribution-title');
    expect(title).toHaveTextContent('jurga@ogmc.example');
    expect(within(title).queryByTestId('actor-kind')).not.toBeInTheDocument();
  });

  it('links the actor to their recent edits on the Activity page', async () => {
    mount(<TopicContextHeader topic={topic(5)} type={TOPIC_TYPE} />);
    await screen.findByTestId('field-attribution-title');
    const links = screen.getAllByRole('link', { name: /their recent edits/i });
    expect(links.map((a) => a.getAttribute('href'))).toContain('/activity?actor=u-jurga');
  });

  it('clicking opens the topic history narrowed to that field', async () => {
    mount(<TopicContextHeader topic={topic(5)} type={TOPIC_TYPE} />);
    fireEvent.click(await screen.findByRole('button', { name: /history of team_verdict/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/revisions?') && c.url.includes('field=team_verdict'))).toBe(true),
    );
    expect(await screen.findByTestId('record-history-narrowed')).toHaveTextContent('team_verdict');
  });
});

describe('topic history — restore', () => {
  it('asserts the NEWER of the shown version and the one this tab last saw', async () => {
    // The header shows v5; this tab has since seen v6 (a drawer save, say).
    rememberVersion('topic-1', { version: 6 });
    mount(<TopicContextHeader topic={topic(5)} type={TOPIC_TYPE} />);
    fireEvent.click(await screen.findByRole('button', { name: /topic history/i }));
    // v4 is Jurga's "good", overwritten by the machine at v5.
    const v4 = (await screen.findByText('v4')).closest('[data-activity-id]') as HTMLElement;
    fireEvent.click(within(v4).getByRole('button', { name: /team_verdict/ }));
    fireEvent.click(within(v4).getByRole('button', { name: /restore this value/i }));
    expect(await screen.findByTestId('restore-preview-team_verdict')).toHaveTextContent(/good/);
    fireEvent.click(screen.getByTestId('restore-confirm'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/v1/entities/topic-1/revisions/4/restore');
    expect(post.body).toEqual({ fields: ['team_verdict'], expected_version: 6 });
  });

  it('refreshes the topic after a restore, so every surface shows the restored value', async () => {
    const { qc } = mount(<TopicContextHeader topic={topic(5)} type={TOPIC_TYPE} />);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: /topic history/i }));
    const v4 = (await screen.findByText('v4')).closest('[data-activity-id]') as HTMLElement;
    fireEvent.click(within(v4).getByRole('button', { name: /team_verdict/ }));
    fireEvent.click(within(v4).getByRole('button', { name: /restore this value/i }));
    fireEvent.click(await screen.findByTestId('restore-confirm'));
    await waitFor(() =>
      expect(spy.mock.calls.some(([arg]) => JSON.stringify(arg?.queryKey) === JSON.stringify(['entity', 'topic-1']))).toBe(true),
    );
  });
});
