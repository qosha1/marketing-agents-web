/**
 * The story page's four answers to "where is my draft?" (bd startsim-z384k).
 *
 * This is the page a reviewer lands on the instant they approve a topic, and the
 * failure mode the bead names explicitly is a blank page or an unexplained
 * spinner. Each case below is one of the four things that can actually be true
 * at that moment, and the two that matter most are the ones that are NOT "here
 * is your draft":
 *
 *  - two or more candidates must never be auto-picked. Drafts written before
 *    2026-09-16 (startsim-yvi57) come in threes; stepping into an arbitrary one
 *    would be a silent editorial choice.
 *  - "no draft" must not be asserted as fact. 38 of 153 live drafts carry no
 *    `topic_ref` (startsim-sr38f), so an empty list here can mean "written, but
 *    unlinked" — and the page has to offer a way to check.
 *
 * `TopicDrafts` is stubbed because it is tested where it lives and because what
 * is under test here is what this page DOES with a settled list. The stub is the
 * contract: it reports the same {drafts, loading, generating, stopped} the real
 * one does — and `generating` is in there because an empty list means opposite
 * things with and without a writer in flight.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

import type { EntityRecord } from '@/lib/foundry-api';

const replace = vi.fn();
const push = vi.fn();

interface Reported {
  drafts: EntityRecord[];
  loading: boolean;
  generating: boolean;
  stopped: string;
}
let reported: Reported = { drafts: [], loading: true, generating: false, stopped: 'idle' };
let searchString = '';

vi.mock('next/navigation', () => ({
  useParams: () => ({ topicId: 'topic-1' }),
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(searchString),
}));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ children, href }: { children?: ReactNode; href?: string }) =>
      React.createElement('a', { href }, children),
  };
});
vi.mock('@/components/entity-detail-drawer', async () => {
  const React = await import('react');
  return {
    TopicDrafts: ({ onDrafts }: { onDrafts?: (s: Reported) => void }) => {
      React.useEffect(() => {
        onDrafts?.(reported);
      }, [onDrafts]);
      return React.createElement('div', { 'data-testid': 'topic-drafts' });
    },
  };
});

const TOPIC = {
  id: 'topic-1',
  entityType: 'topic',
  externalId: null,
  name: 'Qatar customs clearance timelines',
  data: { title: 'Qatar customs clearance timelines', status: 'ready', content_type: 'general' },
  createdAt: '',
} as unknown as EntityRecord;

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
  ],
};

vi.mock('@/lib/foundry-api', () => ({
  getEntity: vi.fn(async () => TOPIC),
  listTypes: vi.fn(async () => ({ count: 1, next: null, previous: null, results: [TOPIC_TYPE] })),
}));

const StoryPage = (await import('../page')).default;

function draft(id: string): EntityRecord {
  return { id, entityType: 'draft', externalId: null, name: id, data: {}, createdAt: '' } as unknown as EntityRecord;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StoryPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  searchString = '';
  reported = { drafts: [], loading: true, generating: false, stopped: 'idle' };
});

describe('the story page', () => {
  it('puts the topic above everything — the context that used to live in the modal', async () => {
    renderPage();
    expect(await screen.findByText('Qatar customs clearance timelines')).toBeInTheDocument();
    expect(screen.getByTestId('topic-drafts')).toBeInTheDocument();
  });

  it('steps straight into the draft when there is exactly one', async () => {
    reported = { drafts: [draft('d1')], loading: false, generating: false, stopped: 'idle' };
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/draft/d1'));
    // `replace`, never `push`: a history entry here would bounce the browser
    // Back button straight off this page and into the redirect again.
    expect(push).not.toHaveBeenCalled();
  });

  it('carries the return path into the draft so "back" still finds the table', async () => {
    searchString = 'from=%2Ft%2Ftopic%3Fcontent_type%3Dgeneral';
    reported = { drafts: [draft('d1')], loading: false, generating: false, stopped: 'idle' };
    renderPage();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/draft/d1?from=%2Ft%2Ftopic%3Fcontent_type%3Dgeneral'),
    );
  });

  it('refuses to follow a return path that would leave the app', async () => {
    searchString = 'from=https%3A%2F%2Fevil.example';
    reported = { drafts: [draft('d1')], loading: false, generating: false, stopped: 'idle' };
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/draft/d1'));
  });

  it('never picks for the reviewer when a legacy topic carries three candidates', async () => {
    reported = { drafts: [draft('d1'), draft('d2'), draft('d3')], loading: false, generating: false, stopped: 'idle' };
    renderPage();
    await screen.findByTestId('topic-drafts');
    await new Promise((r) => setTimeout(r, 20));
    expect(replace).not.toHaveBeenCalled();
  });

  it('waits rather than redirecting while the count is still unknown', async () => {
    reported = { drafts: [draft('d1')], loading: true, generating: false, stopped: 'idle' };
    renderPage();
    await screen.findByTestId('topic-drafts');
    await new Promise((r) => setTimeout(r, 20));
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not assert absence — an empty list offers the drafts table', async () => {
    reported = { drafts: [], loading: false, generating: false, stopped: 'idle' };
    renderPage();
    expect(await screen.findByText(/search the drafts table/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /search the drafts table/i })).toHaveAttribute(
      'href',
      '/t/draft',
    );
  });

  it('does NOT tell a reviewer to go hunt while the writer is still running', async () => {
    // The query settles instantly on a topic approved three seconds ago — with
    // zero drafts, because none exists yet. Rendering the sr38f notice there
    // would print "nothing is linked to this topic, search the drafts table"
    // directly under "Generating… (~2 min)": false in every clause.
    reported = { drafts: [], loading: false, generating: true, stopped: 'idle' };
    renderPage();
    await screen.findByTestId('topic-drafts');
    expect(screen.queryByText(/search the drafts table/i)).toBeNull();
  });

  it('says it once the writer has stopped and still nothing is linked', async () => {
    reported = { drafts: [], loading: false, generating: false, stopped: 'gave_up' };
    renderPage();
    expect(await screen.findByText(/search the drafts table/i)).toBeInTheDocument();
  });

  it('says nothing about unlinked drafts while the list is still loading', async () => {
    reported = { drafts: [], loading: true, generating: false, stopped: 'idle' };
    renderPage();
    await screen.findByTestId('topic-drafts');
    expect(screen.queryByText(/search the drafts table/i)).toBeNull();
  });
});
