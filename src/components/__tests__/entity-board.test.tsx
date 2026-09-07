/**
 * The board card's inline decision cluster (bd startsim-6y458, startsim-edb00).
 *
 * This is the surface a reviewer approves from, and until now nothing about it
 * could go red: that the cluster is on the card at all, that pressing a button
 * decides instead of picking the card up, and that a decision is reported so the
 * lanes can be refetched. All three are DOM facts — a node test cannot see any
 * of them.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';
import { TOPIC_REVIEW_CONFIG } from '@/lib/review-vocabulary';
import type { LaneState } from '@/lib/lanes';

const updateEntity = vi.fn(async () => ({}));

// The cluster writes through the injected client; the board writes a drag/select
// move through saveEntity. Neither should reach a real tenant from a test.
vi.mock('@/lib/foundry-api', () => ({
  collectionClient: { updateEntity: (...args: unknown[]) => updateEntity(...(args as [])) },
}));
vi.mock('@/lib/entity-cache', () => ({ saveEntity: vi.fn(async () => ({})) }));

import { EntityBoard } from '../entity-board';

/** The live OGMC topic pipeline: entry, forward, rejection, terminal. */
const TOPIC_TYPE = {
  id: 1,
  key: 'content',
  label: 'Topic',
  attributes: [
    {
      id: 10,
      name: 'status',
      label: 'Status',
      dataType: 'enum',
      config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
    },
    { id: 11, name: 'team_verdict', label: 'Verdict', dataType: 'string' },
    { id: 12, name: 'team_notes', label: 'Notes', dataType: 'string' },
  ],
} as unknown as EntityTypeDef;

function topic(id: number, name: string, status: string): EntityRecord {
  return { id, name, data: { status } } as unknown as EntityRecord;
}

function lane(records: EntityRecord[]): LaneState {
  return { records, count: records.length, hasMore: false, loading: false };
}

function laneOf(container: HTMLElement, columnId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-rfd-droppable-id="${columnId}"]`);
  if (!el) throw new Error(`no lane rendered for "${columnId}"`);
  return el;
}

function renderBoard(props: Partial<React.ComponentProps<typeof EntityBoard>> = {}) {
  const onDecided = vi.fn();
  const onCardClick = vi.fn();
  // A press anywhere on the card that reaches HERE would have started a drag.
  const ancestorPointerDown = vi.fn();
  const ancestorClick = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const view = render(
    <QueryClientProvider client={qc}>
      <div onPointerDown={ancestorPointerDown} onClick={ancestorClick}>
        <EntityBoard
          type={TOPIC_TYPE}
          lanes={{ suggested: lane([topic(1, 'A topic worth writing', 'suggested')]) }}
          onLoadMore={vi.fn()}
          laneKey={(id) => ['entities', 'content', 'lane', id, 'page', 1]}
          onCardClick={onCardClick}
          review={TOPIC_REVIEW_CONFIG}
          onDecided={onDecided}
          {...props}
        />
      </div>
    </QueryClientProvider>,
  );
  return { ...view, onDecided, onCardClick, ancestorPointerDown, ancestorClick };
}

beforeEach(() => {
  updateEntity.mockClear();
});

describe('board card decision cluster', () => {
  it('puts the decision on the card, named for what it decides', () => {
    renderBoard();

    // The consumer's vocabulary, not the shared default — "Approve" alone is the
    // collision review-vocabulary.ts exists to prevent.
    expect(screen.getByRole('button', { name: 'Approve topic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject topic' })).toBeInTheDocument();
  });

  it('renders no cluster when the caller supplies no review config', () => {
    renderBoard({ review: undefined });

    expect(screen.queryByRole('button', { name: 'Approve topic' })).toBeNull();
    // Still a board: the card and its status fallback are there.
    expect(screen.getByText('A topic worth writing')).toBeInTheDocument();
  });

  it('decides instead of picking the card up', () => {
    const { ancestorPointerDown, ancestorClick, onCardClick } = renderBoard();
    const approve = screen.getByRole('button', { name: 'Approve topic' });

    fireEvent.pointerDown(approve);
    fireEvent.click(approve);

    // The guard on the actions row. Without it a press on a button is a press on
    // the card, and the board starts a drag instead of taking the decision.
    expect(ancestorPointerDown).not.toHaveBeenCalled();
    expect(ancestorClick).not.toHaveBeenCalled();
    // And it is not the card's own open-the-record click either.
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('a press on the card itself still reaches the board, so dragging survives', () => {
    const { ancestorPointerDown } = renderBoard();

    fireEvent.pointerDown(screen.getByText('A topic worth writing'));

    // The guard is scoped to the controls row — it must not deaden the card.
    expect(ancestorPointerDown).toHaveBeenCalled();
  });

  it('writes the coherent status+verdict pair and reports the decision', async () => {
    const { onDecided } = renderBoard();

    fireEvent.click(screen.getByRole('button', { name: 'Approve topic' }));

    await waitFor(() => expect(updateEntity).toHaveBeenCalledTimes(1));
    const [id, payload] = updateEntity.mock.calls[0] as unknown as [
      number,
      { data: Record<string, unknown> },
    ];
    expect(id).toBe(1);
    // Both fields together: `status` is the gate the writer keys off, and
    // `teamVerdict` is what the re-rank agent reads. One without the other looks
    // right on screen and silently desynchronises them.
    expect(payload.data.status).toBe('ready');
    expect(payload.data.teamVerdict).toBe('good');

    // The page refetches on this; without it the card sits in the old lane.
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect((onDecided.mock.calls[0][0] as EntityRecord).id).toBe(1);
  });

  it('the card lands in the lane the decision moved it to', async () => {
    const { container, rerender } = renderBoard();
    const moved = topic(1, 'A topic worth writing', 'ready');

    expect(laneOf(container, 'suggested')).toHaveTextContent('A topic worth writing');
    expect(laneOf(container, 'ready')).not.toHaveTextContent('A topic worth writing');

    // What the page's onDecided refetch produces.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <div>
          <EntityBoard
            type={TOPIC_TYPE}
            lanes={{ suggested: lane([]), ready: lane([moved]) }}
            onLoadMore={vi.fn()}
            laneKey={(id) => ['entities', 'content', 'lane', id, 'page', 1]}
            onCardClick={vi.fn()}
            review={TOPIC_REVIEW_CONFIG}
            onDecided={vi.fn()}
          />
        </div>
      </QueryClientProvider>,
    );

    expect(laneOf(container, 'ready')).toHaveTextContent('A topic worth writing');
    expect(laneOf(container, 'suggested')).not.toHaveTextContent('A topic worth writing');
  });

  it('opens the record when the card title is clicked', () => {
    const { onCardClick } = renderBoard();

    // The title, not the card: @hello-pangea/dnd exposes the draggable wrapper
    // as a button too, so the role query alone is ambiguous here.
    fireEvent.click(screen.getByText('A topic worth writing'));

    expect(onCardClick).toHaveBeenCalledTimes(1);
  });
});
