/**
 * THE RAIL'S HISTORY PANEL IS THE SHARED ONE, OVER THE SERVER TRAIL
 * (bd startsim-j19hf; panel bd startsim-g4rwo; trail bd startsim-o1qib).
 *
 * The rail used to carry a fork-local "Edit history" panel over
 * `data._edit_history` — this app's own log, written inside the blob the tenant
 * PATCH replaces wholesale. These tests pin what replaced it, and each one is a
 * thing a type-check cannot see:
 *
 *  1. THE PANEL IS MOUNTED AT ALL, and lazily. It fetches on mount, and the rail
 *     has eight panels, so an eagerly-mounted trail is a request per draft opened
 *     for a card nobody expanded.
 *  2. THE DECLARED FIELD NAMES SURVIVE. `metadata.changed` is keyed by the
 *     tenant's own attribute names, so a camelising reader would print
 *     `judgeVerdict` — a name this tenant never declared. This is the assertion
 *     that would have caught the camelisation corruption this repo already had.
 *  3. THE INCOMPLETENESS CAVEAT IS NOT SUPPRESSED. The panel's own prop
 *     documentation says to pass `null` only when the surrounding page already
 *     says it, and never to make the panel look more complete than the trail is.
 *     A fork is not the place that decision gets made.
 *
 * The three-state actor vocabulary, the autosave fold and the 404-vs-empty
 * distinction are the shared panel's own and are tested in packages/ui. Nothing
 * here re-tests them; what is tested here is that this fork reaches them.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RevisionPage } from '@startsimpli/ui/history';

import { QualityRail, type QualityRailProps } from '../QualityRail';

/** One sitting by a named person, over two of the tenant's declared attributes. */
const PAGE: RevisionPage = {
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      id: 'r1',
      version: 4,
      action: 'updated',
      source: 'patch',
      precondition: 'matched',
      created_at: '2026-10-06T08:00:00Z',
      actor_label: 'jurga@ogmc.example',
      actor_kind: 'person',
      actor_kind_source: 'claim',
      metadata: {
        changed: {
          judge_verdict: { before: 'revise', after: 'approve' },
          candidate_index: { after: 2 },
        },
      },
    },
  ],
};

function railProps(overrides: Partial<QualityRailProps> = {}): QualityRailProps {
  return {
    checks: [],
    stops: [],
    activeStop: -1,
    onJumpToCheck: vi.fn(),
    legendOpen: false,
    onToggleLegend: vi.fn(),
    judgeVerdictWord: '',
    override: { overridden: false },
    onOverride: vi.fn(),
    review: {} as QualityRailProps['review'],
    onReviewChange: vi.fn(),
    feedbackReady: false,
    canAccept: false,
    acceptGateHint: null,
    notes: [],
    onAddNote: vi.fn(),
    onResolveNote: vi.fn(),
    noteSection: 'general',
    onNoteSectionChange: vi.fn(),
    noteSections: ['general'],
    revisions: { list: vi.fn(async () => PAGE) },
    historyOpen: false,
    onHistoryOpenChange: vi.fn(),
    chain: [],
    currentId: 'd1',
    parentId: '',
    showDiff: false,
    onToggleDiff: vi.fn(),
    blogDiff: '',
    parentLoading: false,
    parentError: false,
    onRefreshParent: vi.fn(),
    ...overrides,
  };
}

function renderRail(props: Partial<QualityRailProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <QualityRail {...railProps(props)} />
    </QueryClientProvider>,
  );
  return result;
}

describe('the rail’s History panel', () => {
  it('reads nothing while it is collapsed', () => {
    const list = vi.fn(async () => PAGE);
    renderRail({ revisions: { list }, historyOpen: false });

    expect(screen.queryByTestId('record-history-panel')).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('asks the host to open it when the header is pressed', () => {
    const onHistoryOpenChange = vi.fn();
    renderRail({ onHistoryOpenChange });

    fireEvent.click(screen.getByRole('button', { name: /^history$/i }));

    // CONTROLLED, so the rail reports rather than deciding: the stale-save
    // dialog's safe default action has to be able to open this from outside.
    expect(onHistoryOpenChange).toHaveBeenCalledWith(true);
  });

  it('renders the shared panel over the record’s own trail once open', async () => {
    const list = vi.fn(async () => PAGE);
    renderRail({ revisions: { list }, historyOpen: true });

    await waitFor(() => expect(screen.getByText(/jurga@ogmc\.example/)).toBeTruthy());
    expect(list).toHaveBeenCalled();
  });

  it('prints the DECLARED attribute names, never a camelised guess', async () => {
    renderRail({ historyOpen: true });

    const panel = await waitFor(() => {
      const found = screen.getByTestId('record-history-panel');
      expect(found.textContent).toContain('judge_verdict');
      return found;
    });
    expect(panel.textContent).toContain('candidate_index');
    expect(panel.textContent).not.toContain('judgeVerdict');
  });

  it('keeps the shared caveat that the trail has known silent write paths', async () => {
    renderRail({ historyOpen: true });

    await waitFor(() => expect(screen.getByTestId('record-history-incomplete')).toBeTruthy());
  });
});
