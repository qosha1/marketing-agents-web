/**
 * RED for bd startsim-1pqb9 — the Activity page: every edit across records,
 * filterable by person, person-vs-machine, type and date, with the filters IN
 * THE URL.
 *
 * Why the URL and why this page: a filter kept in a Next LAYOUT goes stale on
 * the first soft navigation (layouts do not re-render), and a filter kept in
 * component state is lost on reload and cannot be shared. So the page reads the
 * filters from `useSearchParams` and writes them back with `router.replace`, and
 * the shared panel holds none of its own. Also pinned: every row deep-links to
 * its record, and the feed is read raw and by cursor.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
let search = new URLSearchParams('actor=u-jurga');

vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/activity',
}));
vi.mock('next/link', async () => {
  const R = await import('react');
  return {
    default: ({ children, href, className }: { children?: React.ReactNode; href?: string; className?: string }) =>
      R.createElement('a', { href, className }, children),
  };
});
vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: vi.fn(async () => 'test.token.value') }));
vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({
    count: 2,
    results: [
      { id: 1, key: 'topic', label: 'Topic', attributes: [] },
      { id: 2, key: 'draft', label: 'Draft', attributes: [] },
      { id: 3, key: 'scope', label: 'Scope', attributes: [] },
    ],
  })),
  orgMembers: vi.fn(async () => [
    { id: 1, org: 'o', role: 'member', user: { sub: 'u-malin', email: 'malin@ogmc.example' } },
  ]),
}));

const ROWS = {
  next: null,
  next_cursor: null,
  results: [
    {
      id: 'r2',
      version: 3,
      action: 'updated',
      source: 'upsert',
      created_at: '2026-10-07T10:00:00Z',
      actor_sub: 'svc:n8n-ogmc',
      actor_label: 'svc:n8n-ogmc',
      actor_kind: 'machine',
      actor_kind_source: 'claim',
      metadata: { changed: { team_verdict: { before: 'good', after: 'needs_work' } } },
      entity: { id: 'topic-1', type: 'topic', name: 'Qatar logistics' },
    },
    {
      id: 'r1',
      version: 7,
      action: 'updated',
      source: 'patch',
      created_at: '2026-10-07T08:00:00Z',
      actor_sub: 'u-jurga',
      actor_label: 'jurga@ogmc.example',
      actor_kind: 'person',
      actor_kind_source: 'claim',
      metadata: { changed: { blog: { before: 'a', after: 'b' } } },
      entity: { id: 'draft-9', type: 'draft', name: 'Gulf brief' },
    },
    {
      id: 'r0',
      version: 2,
      action: 'updated',
      source: 'patch',
      created_at: '2026-10-07T07:00:00Z',
      actor_sub: 'u-jurga',
      actor_label: 'jurga@ogmc.example',
      actor_kind: 'person',
      actor_kind_source: 'claim',
      metadata: { changed: { brand_voice: { before: 'a', after: 'b' } } },
      entity: { id: 'scope-3', type: 'scope', name: 'OGMC' },
    },
  ],
};

let urls: string[] = [];
beforeEach(() => {
  urls = [];
  replace.mockReset();
  search = new URLSearchParams('actor=u-jurga');
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(ROWS), { status: 200 });
  }) as typeof fetch;
});

const { default: ActivityPage } = await import('../page');

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ActivityPage />
    </QueryClientProvider>,
  );
}

describe('/activity', () => {
  it('reads its filters FROM THE URL and sends them, raw and by cursor', async () => {
    mount();
    await screen.findByText('Gulf brief');
    const feed = urls.find((u) => u.startsWith('/api/v1/revisions'))!;
    const q = new URL(feed, 'http://x').searchParams;
    expect(q.get('actor')).toBe('u-jurga');
    expect(q.has('page')).toBe(false);
  });

  it('writes a filter change back to the URL, keeping the others', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText(/made by/i), { target: { value: 'machine' } });
    expect(replace).toHaveBeenCalledWith('/activity?actor=u-jurga&actor_kind=machine', { scroll: false });
  });

  it('clearing every filter leaves a clean URL', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /clear all/i }));
    expect(replace).toHaveBeenCalledWith('/activity', { scroll: false });
  });

  it('offers the declared record types by their labels', async () => {
    mount();
    const select = (await screen.findByLabelText(/record type/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(2));
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['Topic', 'Draft']),
    );
  });

  it('deep-links each row to its record — a topic to its story page, a draft to its editor', async () => {
    mount();
    expect((await screen.findByRole('link', { name: 'Qatar logistics' })).getAttribute('href')).toMatch(/^\/story\/topic-1/);
    expect(screen.getByRole('link', { name: 'Gulf brief' })).toHaveAttribute('href', '/draft/draft-9');
  });

  it('opens any other type ON the record, not on its whole table (m7fdm.36)', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'OGMC' })).toHaveAttribute('href', '/t/scope?open=scope-3');
  });

  it('names fields the way the forms do, not by storage key', async () => {
    mount();
    expect(await screen.findByText('Edited Brand voice')).toBeTruthy();
    expect(screen.queryByText('Edited brand_voice')).toBeNull();
  });

  it('offers every team member in Person from the first load', async () => {
    mount();
    const select = (await screen.findByRole('combobox', { name: 'Person' })) as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toContain('malin@ogmc.example'),
    );
  });

  it('prints no help paragraph under the title', async () => {
    mount();
    await screen.findByText('Gulf brief');
    expect(screen.queryByText(/newest first — people and machines/)).toBeNull();
  });

  it('marks the machine row', async () => {
    mount();
    await screen.findByText('Qatar logistics');
    expect(screen.getAllByTestId('actor-kind')).toHaveLength(1);
  });
});
