/**
 * The draft page's ONE header (bd startsim-m7fdm.27, Quinn's keep/remove list
 * at claude.ai/artifact/F8tCCpTMTWt8GCQpBHVQrT, collection "elements").
 *
 * Decided rows asserted here: e01 keep the back link; e02 remove the TOPIC label
 * and status chip; e03/e10 topic title and draft title are ONE title; e05 remove
 * "What the reviewer asked for"; e06 Edit topic stays reachable; e07 remove Hide
 * topic; e08 topic history is no longer a second history card in the header;
 * e11 remove the previous/next arrows. Undecided rows are KEPT (relay).
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

vi.mock('next/link', async () => {
  const R = await import('react');
  return { default: ({ children, href }: { children?: ReactNode; href?: string }) => R.createElement('a', { href }, children) };
});
vi.mock('@/lib/entity-cache', () => ({
  saveEntity: vi.fn(),
  primeEntity: vi.fn(),
  entityKey: (id: unknown) => ['entity', String(id)],
  revisionsKey: (id: unknown) => ['entity', String(id), 'revisions'],
}));
vi.mock('@/lib/foundry-api', () => ({ getEntity: vi.fn(async () => ({ id: 't1', data: {} })) }));
vi.mock('@startsimpli/auth', () => ({ useAuth: () => ({ user: { email: 'a@b.c' } }) }));

const { TopicContextHeader } = await import('../TopicContextHeader');
const { DraftHeader } = await import('../DraftHeader');

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 1, name: 'title', dataType: 'text', required: false, config: {} },
    { id: 2, name: 'angle', dataType: 'longtext', required: false, config: {} },
    { id: 3, name: 'market', dataType: 'text', required: false, config: {} },
    { id: 5, name: 'status', dataType: 'enum', required: false, config: { choices: ['suggested', 'ready', 'written'] } },
    { id: 7, name: 'team_notes', dataType: 'longtext', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

const TOPIC = {
  id: 't1',
  entityType: 'topic',
  name: 'fallback',
  createdAt: '',
  data: {
    title: 'Qatar Market Entry Guide 2026',
    angle: 'Lead with the fee and what it replaces.',
    market: 'Qatar',
    status: 'ready',
    team_notes: 'angle too broad; needs a 2026 source',
  },
} as unknown as EntityRecord;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('TopicContextHeader, inline (the draft page)', () => {
  const view = () => wrap(<TopicContextHeader variant="inline" topic={TOPIC} type={TOPIC_TYPE} />);

  it('has no second title, no TOPIC label or status chip', () => {
    const { container } = view();
    expect(container.querySelector('h1, h2, h3')).toBeNull();
    expect(screen.queryByText('Qatar Market Entry Guide 2026')).toBeNull();
    expect(screen.queryByText(/^topic$/i)).toBeNull();
    expect(screen.queryByText('ready')).toBeNull();
  });

  it('drops the reviewer note and the Hide topic button', () => {
    view();
    expect(screen.queryByText('What the reviewer asked for')).toBeNull();
    expect(screen.queryByText(/needs a 2026 source/)).toBeNull();
    expect(screen.queryByRole('button', { name: /hide topic|show topic/i })).toBeNull();
  });

  it('keeps the angle and the Edit topic control, and has no card of its own', () => {
    const { container } = view();
    expect(screen.getByText(/Lead with the fee/)).toBeInTheDocument();
    expect(screen.getByText('Qatar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit topic/i }));
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(container.querySelector('section.rounded-xl')).toBeNull();
  });

  it('has no second history card (topic history lives in the page History)', () => {
    view();
    expect(screen.queryByText('Topic history')).toBeNull();
  });
});

describe('TopicContextHeader, card (the story page) is unchanged', () => {
  it('still shows its title, note and Hide topic', () => {
    wrap(<TopicContextHeader topic={TOPIC} type={TOPIC_TYPE} />);
    expect(screen.getByRole('heading', { name: 'Qatar Market Entry Guide 2026' })).toBeInTheDocument();
    expect(screen.getByText('What the reviewer asked for')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide topic/i })).toBeInTheDocument();
  });
});

describe('DraftHeader', () => {
  const props = {
    back: <span>← Weekly Briefs</span>,
    title: 'Qatar shortens customs clearance',
    titleMeta: <span>edited by A</span>,
    status: <span>Ready for review</span>,
    languages: <span>EN</span>,
    onHistory: vi.fn(),
    historyOpen: false,
    children: <p>topic strip</p>,
  };

  it('has exactly one heading, and it is the draft title', () => {
    const { container } = wrap(<DraftHeader {...props} />);
    const headings = container.querySelectorAll('h1,h2,h3,h4');
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe('H1');
    expect(headings[0].textContent).toBe('Qatar shortens customs clearance');
  });

  it('keeps the back link, status and languages, and has no previous/next arrows', () => {
    wrap(<DraftHeader {...props} />);
    expect(screen.getByText('← Weekly Briefs')).toBeInTheDocument();
    expect(screen.getByText('Ready for review')).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /previous draft|next draft/i })).toBeNull();
  });

  it('puts History in the header, one button, reflecting open state', () => {
    const onHistory = vi.fn();
    wrap(<DraftHeader {...props} onHistory={onHistory} />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /history/i })).toHaveAttribute('aria-expanded', 'false');
  });
});
