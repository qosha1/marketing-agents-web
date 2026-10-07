/**
 * "REQUEST CHANGES" IS A HUMAN VERDICT ONLY (bd startsim-whwxd.6).
 *
 * The rail's "Request changes" decision used to feed an AI rewrite: the
 * feedback box asked "What should the rewrite fix?", told the reviewer to "send
 * to the AI", and the decision bar offered "Request revision", which POSTed the
 * critique to an n8n webhook that wrote a NEW draft into the tenant. That feature
 * is removed. What stays: the verdict, the feedback box (autosaved on the draft
 * with the rest of the review), and the lineage of drafts the rewrite already
 * created, which are left untouched.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntityRecord } from '@/lib/foundry-api';

import { QualityRail, type QualityRailProps } from '../QualityRail';

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
    review: { verdict: 'revise' } as QualityRailProps['review'],
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
    revisions: { list: vi.fn() },
    historyOpen: false,
    onHistoryOpenChange: vi.fn(),
    chain: [],
    currentId: 'd2',
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
  return render(
    <QueryClientProvider client={qc}>
      <QualityRail {...railProps(props)} />
    </QueryClientProvider>,
  );
}

describe('Request changes, with the AI rewrite removed', () => {
  it('keeps the feedback box, and nothing on the rail offers an AI rewrite', () => {
    const { container } = renderRail();
    expect(screen.getByLabelText('What needs to change?')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Request revision/i);
    expect(text).not.toMatch(/to the AI/i);
    expect(text).not.toMatch(/rewrite/i);
    const box = screen.getByLabelText('What needs to change?') as HTMLTextAreaElement;
    expect(box.placeholder).not.toMatch(/AI/);
  });

  it('still shows the lineage of drafts an earlier AI revision created', () => {
    const v1 = { id: 'd1', data: {} } as unknown as EntityRecord;
    const v2 = { id: 'd2', data: { revised_from: 'd1' } } as unknown as EntityRecord;
    renderRail({ chain: [v1, v2], parentId: 'd1' });
    expect(screen.getByText('Revision history')).toBeInTheDocument();
  });
});
