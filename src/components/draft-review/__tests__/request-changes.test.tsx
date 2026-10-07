/**
 * "REQUEST CHANGES" IS GONE FROM THE DRAFT DECISION (bd startsim-m7fdm.24).
 *
 * #93 (bd startsim-whwxd.6) removed the AI rewrite that "Request changes" fed,
 * which left it as a third decision that only saved a verdict and a note. Quinn
 * decided 2026-10-07 to remove it: the rail offers Approve draft and Reject
 * draft, and nothing else.
 *
 * Drafts already carrying review.verdict = 'revise' are NOT rewritten. The rail
 * still renders them, says what is stored in its raw form, presses no button,
 * and keeps any feedback that was saved with it visible (read-only).
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
    review: {},
    onReviewChange: vi.fn(),
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

function decisionButtons(): string[] {
  return screen
    .getAllByRole('button')
    .filter((b) => b.hasAttribute('aria-pressed'))
    .map((b) => b.textContent ?? '');
}

describe('the draft decision offers Approve and Reject only', () => {
  it('renders exactly two decision buttons and no "Request changes"', () => {
    const { container } = renderRail();
    expect(decisionButtons()).toEqual(['Approve draft', 'Reject draft']);
    expect(container.textContent ?? '').not.toMatch(/Request changes/i);
    expect(screen.queryByLabelText('What needs to change?')).toBeNull();
  });

  it('has no "r" shortcut in the legend', () => {
    // The legend sits in the issue panel, which only shows with a failing check.
    const checks = [{ id: 'c1', label: 'Word count', status: 'fail' }] as QualityRailProps['checks'];
    const { container } = renderRail({ legendOpen: true, checks });
    const keys = Array.from(container.querySelectorAll('dl kbd')).map((k) => k.textContent);
    expect(keys).toContain('a');
    expect(keys).toContain('x');
    expect(keys).not.toContain('r');
    expect(container.textContent ?? '').not.toMatch(/Request changes/i);
  });
});

describe('a draft that already carries the removed "revise" decision', () => {
  const legacy = { verdict: 'revise' } as QualityRailProps['review'];

  it('still renders, names the stored value raw, and presses no button', () => {
    const { container } = renderRail({ review: legacy });
    const pressed = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toEqual([]);
    expect(decisionButtons()).toEqual(['Approve draft', 'Reject draft']);
    const text = container.textContent ?? '';
    expect(text).toMatch(/revise/);
    expect(text).not.toMatch(/Request changes/i);
  });

  it('keeps the feedback saved with it visible, read-only', () => {
    renderRail({ review: { ...legacy, overallNote: 'Use a fresher source.' } });
    expect(screen.getByText('Use a fresher source.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /What needs to change/i })).toBeNull();
  });

  it('does not rewrite the stored decision just by being shown', () => {
    const onReviewChange = vi.fn();
    renderRail({ review: legacy, onReviewChange });
    expect(onReviewChange).not.toHaveBeenCalled();
  });
});

describe('lineage from the removed AI rewrite', () => {
  it('still shows the drafts an earlier AI revision created', () => {
    const v1 = { id: 'd1', data: {} } as unknown as EntityRecord;
    const v2 = { id: 'd2', data: { revised_from: 'd1' } } as unknown as EntityRecord;
    renderRail({ chain: [v1, v2], parentId: 'd1' });
    expect(screen.getByText('Revision history')).toBeInTheDocument();
  });
});
