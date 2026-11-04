import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { page, renderPage } from '@/lib/research/__tests__/page-harness';
import { NEWS_TYPE, record, TOPIC_TYPE } from '@/lib/research/__tests__/fixtures';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ topicId: 't1' }),
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ children, href }: { children?: React.ReactNode; href?: string }) =>
      React.createElement('a', { href }, children),
  };
});
const api = vi.hoisted(() => ({ getEntity: vi.fn(), listEntities: vi.fn(), listTypes: vi.fn() }));
vi.mock('@/lib/foundry-api', () => api);
const start = vi.hoisted(() => ({ startContent: vi.fn(), fetchTopicDrafts: vi.fn() }));
vi.mock('@/lib/research/start-content', () => ({ startContent: start.startContent }));
vi.mock('@/lib/topic-drafts', () => ({ fetchTopicDrafts: start.fetchTopicDrafts }));

import TopicPage from '../page';

const TOPIC = record('t1', 'topic', {
  title: 'New trade route', angle: 'Why it matters', market: 'UAE', status: 'ready',
  source_1: 'https://a.example/1', source_2: 'https://b.example/2',
});
const DOC = record('n1', 'news_item', {
  title: 'Route opens', url: 'https://a.example/1', source_name: 'Example Wire',
  published_at: '2026-10-16', snippet: 'The route opened on Monday.',
});

beforeEach(() => {
  push.mockReset();
  start.startContent.mockReset();
  start.fetchTopicDrafts.mockReset().mockResolvedValue([]);
  api.getEntity.mockReset().mockResolvedValue(TOPIC);
  api.listTypes.mockReset().mockResolvedValue(page([TOPIC_TYPE, NEWS_TYPE] as never));
  api.listEntities.mockReset().mockResolvedValue(page([DOC]));
});

describe('Research > one topic', () => {
  it('shows the documents in this topic, each with title link, outlet and date, and one quote', async () => {
    renderPage(<TopicPage />);
    expect(await screen.findByText('Documents in this topic')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Route opens' })).toHaveAttribute('href', 'https://a.example/1');
    expect(screen.getByText(/Example Wire · /)).toBeInTheDocument();
    expect(screen.getByText(/The route opened on Monday\./)).toBeInTheDocument();
  });

  it('has exactly one button, Start content, and no brief field, tick boxes or Work on this', async () => {
    renderPage(<TopicPage />);
    await screen.findByText('Documents in this topic');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Start content']);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByText(/work on this/i)).toBeNull();
  });

  it('hides "Content made from this topic" when nothing was made', async () => {
    renderPage(<TopicPage />);
    await screen.findByText('Documents in this topic');
    expect(screen.queryByText('Content made from this topic')).toBeNull();
  });

  it('shows it, linking to the draft, when content exists', async () => {
    start.fetchTopicDrafts.mockResolvedValue([record('d1', 'draft', { status: 'ready_for_review' }, { name: 'Route opens: the brief' })]);
    renderPage(<TopicPage />);
    expect(await screen.findByText('Content made from this topic')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Route opens: the brief/ })).toHaveAttribute('href', '/draft/d1');
  });

  it('Start content creates the draft from the topic and opens it', async () => {
    start.startContent.mockResolvedValue({ href: '/story/t1', started: true });
    renderPage(<TopicPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start content' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/story/t1'));
    expect(start.startContent.mock.calls[0][0]).toBe(TOPIC);
  });
});
