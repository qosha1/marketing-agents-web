import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { page, renderPage } from '@/lib/research/__tests__/page-harness';
import { NEWS_TYPE, record } from '@/lib/research/__tests__/fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/research/sources',
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({ listEntities: vi.fn(), listTypes: vi.fn(), updateEntity: vi.fn() }));
vi.mock('@/lib/foundry-api', () => api);

import SourcesPage from '../page';

const DOCS = [
  record('n1', 'news_item', { title: 'Route opens', source_name: 'Example Wire', published_at: '2026-10-20', status: 'acceptable' }),
  record('n2', 'news_item', { title: 'Fee changes', source_name: 'Ministry', published_at: '2026-10-19', status: 'rejected' }),
  record('n3', 'news_item', { title: 'Visa rule', source_name: 'Example Wire', published_at: '2026-10-18', status: 'new' }),
];

beforeEach(() => {
  api.updateEntity.mockReset().mockResolvedValue({});
  api.listTypes.mockReset().mockResolvedValue(page([NEWS_TYPE] as never));
  api.listEntities.mockReset().mockImplementation(async (type: string) =>
    type === 'source'
      ? page([record('s1', 'source', { domain: 'x' }, { name: 'Example Wire' }), record('s2', 'source', {}, { name: 'Ministry' })])
      : page(DOCS, 61),
  );
});

describe('Research > Sources (pulled-in documents)', () => {
  it('has Document, Source, Published, Review columns and no page actions', async () => {
    renderPage(<SourcesPage />);
    await screen.findByText('Route opens');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/\s+/g, ''))).toEqual([
      'Document', 'Source', 'Published', 'Review',
    ]);
    expect(screen.queryByRole('button', { name: /add|new|create|import/i })).toBeNull();
  });

  it('shows each review state in words', async () => {
    renderPage(<SourcesPage />);
    const row = (await screen.findByText('Visa rule')).closest('tr')!;
    expect(within(row).getByText('Not reviewed')).toBeInTheDocument();
    const good = (await screen.findByText('Route opens')).closest('tr')!;
    expect(within(good).getByRole('button', { name: 'Good' })).toHaveAttribute('aria-pressed', 'true');
    const bad = screen.getByText('Fee changes').closest('tr')!;
    expect(within(bad).getByRole('button', { name: 'Not good' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Good and Not good are row actions that write the existing review status', async () => {
    renderPage(<SourcesPage />);
    const row = (await screen.findByText('Visa rule')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Good' }));
    await waitFor(() => expect(api.updateEntity).toHaveBeenCalledTimes(1));
    expect(api.updateEntity.mock.calls[0][0]).toBe('n3');
    expect(api.updateEntity.mock.calls[0][1].data.status).toBe('acceptable');
    fireEvent.click(within(row).getByRole('button', { name: 'Not good' }));
    await waitFor(() => expect(api.updateEntity).toHaveBeenCalledTimes(2));
    expect(api.updateEntity.mock.calls[1][1].data.status).toBe('rejected');
  });

  it('filters by source, review and date on the server, and pages on the server', async () => {
    renderPage(<SourcesPage />);
    await screen.findByText('Route opens');
    fireEvent.change(screen.getByLabelText('Review'), { target: { value: 'good' } });
    await waitFor(() => {
      const last = api.listEntities.mock.calls.filter((c) => c[0] === 'news_item').at(-1)!;
      expect(last[2]['attr.status']).toBe('acceptable');
    });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Ministry' } });
    await waitFor(() => {
      const last = api.listEntities.mock.calls.filter((c) => c[0] === 'news_item').at(-1)!;
      expect(last[2]['attr.source_name']).toBe('Ministry');
    });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '7' } });
    await waitFor(() => {
      const last = api.listEntities.mock.calls.filter((c) => c[0] === 'news_item').at(-1)!;
      expect(last[2]['attr.published_at__gte']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
