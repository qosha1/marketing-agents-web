/**
 * A view-only reader is not shown controls they cannot use (bd startsim-whwxd.22,
 * epic startsim-768w.71).
 *
 * #102 hid most of the draft page's write controls from someone whose share on
 * the draft is "Can view". Two were left: the "+ AR / + ZH" translate buttons,
 * which create a new draft in the same space, and the Approve draft / Reject
 * draft decision, which rendered DISABLED with a tooltip. Quinn's rule is that a
 * control the person cannot use is hidden, not greyed out.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntityRecord } from '@/lib/foundry-api';

vi.mock('@/lib/topic-drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/topic-drafts')>()),
  fetchDraftTranslations: vi.fn(async () => []),
}));
vi.mock('@/lib/foundry-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/foundry-api')>()),
  listTypes: vi.fn(async () => ({
    results: [
      {
        key: 'draft',
        attributes: [{ name: 'lang', dataType: 'enum', config: { choices: ['en', 'ar', 'zh'] } }],
      },
    ],
  })),
}));

import { LanguageSwitcher } from '../LanguageSwitcher';
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

function withQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const decisionButtons = () =>
  screen.queryAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));

describe('the draft decision for a view-only reader', () => {
  it('is hidden, not disabled', () => {
    withQuery(<QualityRail {...railProps({ canEdit: false })} />);
    expect(decisionButtons()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Approve draft|Reject draft/ })).toBeNull();
    expect(screen.queryByTitle(/not decide on it/)).toBeNull();
  });

  it('does not tell them to press a button they do not have', () => {
    const { container } = withQuery(
      <QualityRail {...railProps({ canEdit: false, review: { verdict: 'approve' } })} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/button below/i);
    expect(text).not.toMatch(/Choose one below/i);
    expect(text).not.toMatch(/Accept is unlocked|You’re signing off/);
  });

  it('keeps the earlier feedback on the record readable', () => {
    withQuery(
      <QualityRail
        {...railProps({ canEdit: false, review: { verdict: 'revise', overallNote: 'Use a fresher source.' } })}
      />,
    );
    expect(screen.getByText('Use a fresher source.')).toBeInTheDocument();
  });

  it('drops the a / x shortcuts from the legend', () => {
    const checks = [{ id: 'c1', label: 'Word count', status: 'fail' }] as QualityRailProps['checks'];
    const { container } = withQuery(
      <QualityRail {...railProps({ canEdit: false, legendOpen: true, checks })} />,
    );
    const keys = Array.from(container.querySelectorAll('dl kbd')).map((k) => k.textContent);
    expect(keys).toContain('j');
    expect(keys).not.toContain('a');
    expect(keys).not.toContain('x');
  });

  it('is still offered to someone who can edit', () => {
    withQuery(<QualityRail {...railProps({ canEdit: true })} />);
    expect(decisionButtons().map((b) => b.textContent)).toEqual(['Approve draft', 'Reject draft']);
  });
});

const draft = { id: 'd1', name: 'A brief', data: { lang: 'en' } } as unknown as EntityRecord;

describe('the translate buttons', () => {
  it('are hidden from a view-only reader', async () => {
    withQuery(<LanguageSwitcher draft={draft} canEdit={false} />);
    await waitFor(() => expect(screen.getByText(/No translations yet/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /\+ ar|\+ zh/i })).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('are offered to someone who can edit', async () => {
    withQuery(<LanguageSwitcher draft={draft} canEdit />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ ar' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '+ zh' })).toBeInTheDocument();
  });
});
