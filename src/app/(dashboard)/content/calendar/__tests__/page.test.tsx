import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderPage } from '@/lib/research/__tests__/page-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/content/calendar',
}));
const api = vi.hoisted(() => ({ listAllEntities: vi.fn(), listEntities: vi.fn() }));
vi.mock('@/lib/foundry-api', () => api);

import CalendarPage from '../page';

const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;
const posted = { id: 'p1', name: 'Went out', entityType: 'draft', data: { status: 'published', sent_at: day } };

beforeEach(() => {
  api.listAllEntities.mockReset();
});

describe('Calendar when a month query is refused (QA org lacks draft.scheduled_for)', () => {
  it('still draws the grid, says so calmly, and does not crash', async () => {
    api.listAllEntities.mockImplementation(async () => {
      throw new Error('400 unknown attribute scheduled_for');
    });
    renderPage(<CalendarPage />);
    await screen.findByText(/Scheduling is not set up for this project yet/);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing scheduled this month/)).toBeNull();
  });

  it('shows what did load: posted items stay on the grid when scheduled ones are refused', async () => {
    api.listAllEntities.mockImplementation(async (_t: string, o: { filters: Record<string, string> }) => {
      if (o.filters['attr.scheduled_for__gte']) throw new Error('400');
      return [posted];
    });
    renderPage(<CalendarPage />);
    await waitFor(() => expect(screen.getByText('Went out · posted')).toBeInTheDocument());
  });
});
