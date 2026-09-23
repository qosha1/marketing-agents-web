/**
 * The topic, at the top of its draft (bd startsim-z384k).
 *
 * THE REAL DECIDER RUNS HERE. `resolveReviewConfig` is imported for real, not
 * stubbed: the whole claim this component makes is that it shows the same fields
 * the modal shows because it resolves the same field map from the same schema. A
 * mocked resolver would test a hand-written list of attribute names, which is
 * exactly the thing this component exists not to be.
 *
 * The fixture is the live marketing-agents `topic` schema, read from
 * `GET /api/v1/schema/types/` on 2026-09-22.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ children, href }: { children?: ReactNode; href?: string }) =>
      React.createElement('a', { href }, children),
  };
});

const { TopicContextHeader } = await import('../TopicContextHeader');

const TOPIC_TYPE = {
  id: 1,
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 1, name: 'title', dataType: 'text', required: false, config: {} },
    { id: 2, name: 'angle', dataType: 'longtext', required: false, config: {} },
    { id: 3, name: 'market', dataType: 'text', required: false, config: {} },
    {
      id: 4,
      name: 'content_type',
      dataType: 'enum',
      required: false,
      config: { choices: ['weekly_brief', 'lead_magnet', 'general'] },
    },
    {
      id: 5,
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
    },
    { id: 6, name: 'ai_rank', dataType: 'number', required: false, config: {} },
    { id: 7, name: 'team_notes', dataType: 'longtext', required: false, config: {} },
    { id: 8, name: 'source_1', dataType: 'text', required: false, config: {} },
    { id: 9, name: 'subtitle', dataType: 'text', required: false, config: {} },
  ],
} as unknown as EntityTypeDef;

function topic(data: Record<string, unknown>): EntityRecord {
  return {
    id: 't1',
    entityType: 'topic',
    externalId: null,
    name: 'fallback name',
    data,
    createdAt: '',
  } as unknown as EntityRecord;
}

const FULL = topic({
  title: 'Qatar Market Entry Guide 2026',
  subtitle: 'What the new licence actually changes',
  angle: 'Lead with the $137 fee and what it replaces.',
  market: 'Qatar',
  content_type: 'lead_magnet',
  status: 'ready',
  ai_rank: 3,
  team_notes: 'angle too broad; needs a 2026 source',
  source_1: 'https://example.gov.qa/licence',
});

describe('TopicContextHeader', () => {
  it('carries the topic context a reviewer needs while judging the draft', () => {
    render(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} />);

    expect(screen.getByText('Qatar Market Entry Guide 2026')).toBeInTheDocument();
    expect(screen.getByText('What the new licence actually changes')).toBeInTheDocument();
    expect(screen.getByText(/Lead with the \$137 fee/)).toBeInTheDocument();
    expect(screen.getByText('Qatar')).toBeInTheDocument();
    // content_type reads as the team's own word, not as the stored enum value.
    expect(screen.getByText('Evergreen')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('shows the note that asked for the draft — the thing it was meant to satisfy', () => {
    render(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} />);
    expect(screen.getByText('What the reviewer asked for')).toBeInTheDocument();
    expect(screen.getByText('angle too broad; needs a 2026 source')).toBeInTheDocument();
  });

  it('leaves out ai_rank and the topic sources, deliberately', () => {
    render(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} />);
    // ai_rank ranks nothing once the topic is approved and a draft exists.
    expect(screen.queryByText('3')).toBeNull();
    // The draft page owns sources, with tier checks the topic's bare urls have
    // no part in. Two source lists on one page would disagree.
    expect(screen.queryByText(/example\.gov\.qa/)).toBeNull();
  });

  it('says plainly when a draft has no topic, rather than rendering an empty card', () => {
    render(<TopicContextHeader topic={null} type={TOPIC_TYPE} />);
    expect(screen.getByText(/not linked to a topic/i)).toBeInTheDocument();
  });

  it('renders every field it can from a sparse topic without inventing any', () => {
    render(<TopicContextHeader topic={topic({ title: 'Bare' })} type={TOPIC_TYPE} />);
    expect(screen.getByText('Bare')).toBeInTheDocument();
    expect(screen.queryByText('What the reviewer asked for')).toBeNull();
  });

  it('falls back to the record name when the title attribute is empty', () => {
    render(<TopicContextHeader topic={topic({ status: 'suggested' })} type={TOPIC_TYPE} />);
    expect(screen.getByText('fallback name')).toBeInTheDocument();
  });

  it('collapses on request, and has no collapse control when the page IS the topic', () => {
    const { rerender } = render(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} />);
    expect(screen.getByRole('button', { name: /hide topic/i })).toBeInTheDocument();

    rerender(<TopicContextHeader topic={FULL} type={TOPIC_TYPE} alwaysOpen />);
    expect(screen.queryByRole('button', { name: /topic/i })).toBeNull();
    expect(screen.getByText(/Lead with the \$137 fee/)).toBeInTheDocument();
  });

  it('still renders the back link and the heading before the schema has loaded', () => {
    render(
      <TopicContextHeader
        topic={FULL}
        type={null}
        backLink={<span data-testid="back-link">Back to topics</span>}
      />,
    );
    expect(screen.getByText('Qatar Market Entry Guide 2026')).toBeInTheDocument();
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });
});
