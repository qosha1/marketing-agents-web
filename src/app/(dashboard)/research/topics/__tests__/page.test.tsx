import { screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { page, renderPage } from '@/lib/research/__tests__/page-harness';
import { record } from '@/lib/research/__tests__/fixtures';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/research/topics',
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({ listEntities: vi.fn() }));
vi.mock('@/lib/foundry-api', () => api);

import TopicsPage from '../page';

beforeEach(() => {
  push.mockReset();
  api.listEntities.mockReset();
  api.listEntities.mockImplementation(async (type: string) => {
    if (type === 'draft') return page([record('d1', 'draft', { topic_ref: 't1' }), record('d2', 'draft', { topic_ref: 't1' })]);
    return page([
      record('t1', 'topic', { title: 'New trade route', angle: 'Why it matters', market: 'UAE', status: 'ready', source_1: 'a', source_2: 'b' }),
      record('t2', 'topic', { title: 'Licence fee change', market: 'Kuwait', status: 'suggested', source_1: 'c' }),
    ], 24);
  });
});

describe('Research > Topics', () => {
  it('lists Topic, Sources, Markets, Dates, In Content and nothing more', async () => {
    renderPage(<TopicsPage />);
    await screen.findByText('New trade route');
    for (const h of ['Topic', 'Sources', 'Markets', 'Dates', 'In Content']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(`^${h}`) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getByText('2 items in Content')).toBeInTheDocument();
    expect(screen.getByText('None yet')).toBeInTheDocument();
    expect(screen.queryByText(/work on this/i)).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('reads the page of topics from the server, with the drafts of just those topics', async () => {
    renderPage(<TopicsPage />);
    await screen.findByText('New trade route');
    const topicCall = api.listEntities.mock.calls.find((c) => c[0] === 'topic')!;
    expect(topicCall[1]).toBe(1);
    const draftCall = api.listEntities.mock.calls.find((c) => c[0] === 'draft')!;
    expect(draftCall[2]['attr.topic_ref__in']).toBe('t1,t2');
  });

  it('opens one topic on click', async () => {
    renderPage(<TopicsPage />);
    fireEvent.click(await screen.findByText('Licence fee change'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/research/topics/t2'));
  });

  it('says so when there are no topics', async () => {
    api.listEntities.mockResolvedValue(page([]));
    renderPage(<TopicsPage />);
    expect(await screen.findByText(/No topics yet/)).toBeInTheDocument();
  });
});
