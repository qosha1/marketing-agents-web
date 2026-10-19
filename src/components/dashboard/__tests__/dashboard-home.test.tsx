/**
 * The Dashboard's page chrome and its onward links (wireframe review, epic
 * startsim-89qmd).
 *
 * - The page is called what the sidebar calls it, at the h1 size every other
 *   page uses, with no caption (startsim-cl61n, startsim-flt8u).
 * - A Content pipeline stage opens the Topics table on that state; it used to
 *   be a disabled button that looked clickable (startsim-m7fdm.35).
 * - The Ingestion card's figures open the articles and the sources
 *   (startsim-prolm).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 10, name: 'status', dataType: 'enum', config: { choices: ['suggested', 'ready', 'rejected', 'written'] } },
  ],
} as unknown as EntityTypeDef;
const NEWS_TYPE = {
  id: 3,
  key: 'news_item',
  label: 'News item',
  attributes: [{ id: 30, name: 'status', dataType: 'enum', config: { choices: ['new', 'acceptable'] } }],
} as unknown as EntityTypeDef;
const SOURCE_TYPE = {
  id: 4,
  key: 'source',
  label: 'Approved Source',
  attributes: [{ id: 40, name: 'domain', dataType: 'text', config: {} }],
} as unknown as EntityTypeDef;

const TOPICS = [
  { id: 'T1', name: 'a', data: { status: 'written', team_verdict: 'good' }, createdAt: '2026-09-01' },
  { id: 'T2', name: 'b', data: { status: 'suggested', team_verdict: 'good' }, createdAt: '2026-09-01' },
] as unknown as EntityRecord[];
const SOURCES = [{ id: 'S1', name: 'gulfnews', data: { domain: 'gulfnews.com' } }] as unknown as EntityRecord[];
const NEWS = [
  { id: 'N1', name: 'n1', data: { domain: 'gulfnews.com' }, createdAt: '2026-10-18T06:00:00Z' },
  { id: 'N2', name: 'n2', data: { domain: 'gulfnews.com' }, createdAt: '2026-10-18T00:00:00Z' },
] as unknown as EntityRecord[];

vi.mock('@/lib/foundry-api', () => ({
  listTypes: vi.fn(async () => ({ results: [TOPIC_TYPE, NEWS_TYPE, SOURCE_TYPE] })),
  listAllEntities: vi.fn(async (typeKey: string) =>
    typeKey === 'topic' ? TOPICS : typeKey === 'source' ? SOURCES : [],
  ),
  listEntities: vi.fn(async () => ({ count: 3648, results: NEWS, next: null })),
  orgMembers: vi.fn(async () => []),
}));

import { DashboardHome } from '@/components/dashboard';
import { IngestionWidget, PipelineHealthWidget } from '@/components/dashboard/widgets';

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => push.mockReset());

describe('Dashboard page chrome', () => {
  it('is titled "Dashboard" as the page h1, with no caption', () => {
    wrap(<DashboardHome />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Dashboard');
    expect(h1.className).toContain('text-2xl');
    expect(screen.queryByText(/System health/)).toBeNull();
    expect(screen.queryByText(/What needs a human right now/)).toBeNull();
  });
});

describe('Content pipeline stages', () => {
  it('a stage opens the Topics table filtered to that state', async () => {
    wrap(<PipelineHealthWidget />);
    const written = (await screen.findByText('written')).closest('button')!;
    expect(written).not.toBeDisabled();
    fireEvent.click(written);
    expect(push).toHaveBeenCalledWith('/t/topic?status=written');
  });
});

describe('Ingestion card links', () => {
  it('the article count opens the articles and the sources line opens the sources', async () => {
    wrap(<IngestionWidget />);
    const articles = await screen.findByRole('link', { name: /3,648 articles all-time/ });
    // Same route the sidebar's Data item uses: news_item has a status enum, so a board.
    await waitFor(() => expect(articles).toHaveAttribute('href', '/board/news_item'));
    expect(screen.getByRole('link', { name: /1 of 1 approved sources/ })).toHaveAttribute('href', '/t/source');
  });
});
