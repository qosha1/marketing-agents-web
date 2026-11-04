import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderPage } from '@/lib/research/__tests__/page-harness';

const load = vi.hoisted(() => ({ loadOverview: vi.fn() }));
vi.mock('@/lib/research/overview', async (orig) => ({ ...(await orig<object>()), loadOverview: load.loadOverview }));

import OverviewPage from '../page';

beforeEach(() => {
  load.loadOverview.mockReset().mockResolvedValue({
    sourcesConfigured: 5, sourcesOn: 4, documentsThisWeek: 7, topicsInProgress: 4, madeIntoContent: 9,
    stages: { collecting: 2, ready: 2, made: 9 },
    bars: [0, 1, 0, 2, 4, 0, 0].map((count, i) => ({ day: `2026-10-${29 + i}`.replace('-32', '-01'), count })),
  });
});

describe('Research > Overview', () => {
  it('shows the four read-only tiles', async () => {
    renderPage(<OverviewPage />);
    for (const label of ['Sources configured', 'Documents this week', 'Topics in progress', 'Made into content']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('draws seven bars under "Documents in, per day"', async () => {
    renderPage(<OverviewPage />);
    await screen.findByText('Documents in, per day');
    expect(screen.getAllByTestId('day-bar')).toHaveLength(7);
  });

  it('lists topics by stage', async () => {
    renderPage(<OverviewPage />);
    for (const s of ['Collecting', 'Ready to write', 'Made into content']) {
      expect((await screen.findAllByText(s)).length).toBeGreaterThan(0);
    }
    const panel = screen.getByRole('heading', { name: 'Topics' }).closest('section')!;
    expect(panel).toHaveTextContent(/Collecting\s*2/);
    expect(panel).toHaveTextContent(/Made into content\s*9/);
  });
});
