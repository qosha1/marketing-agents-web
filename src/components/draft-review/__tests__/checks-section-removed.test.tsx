/**
 * The draft rail keeps only History (bd startsim-m7fdm.25).
 *
 * Quinn, 2026-10-08, on the Checks / AI judge / validation section: "we want to
 * get rid of this whole section. it does nothing and is confusing and poorly
 * designed." Asked about the rest of the rail he removed the Approve draft /
 * Reject draft decision (and the checks gate on it), Notes, and the "AI judge
 * suggests" header pill as well, and kept History.
 *
 * Gone from the rail: Checks x/n, the AI-judge suggestion, "N issues to look
 * at" with its j/k jump, Adjust the AI's scores, Validation, the decision and
 * Notes. Gone from the keyboard: j / k (issues), a / x (decision) and ? (the
 * legend that lived in the decision card). [ / ] still step the queue.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HistoryRail, type HistoryRailProps } from '../HistoryRail';
import { draftShortcut } from '@/lib/keyboard';

function railProps(overrides: Partial<HistoryRailProps> = {}): HistoryRailProps {
  return {
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

function renderRail(props: Partial<HistoryRailProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HistoryRail {...railProps(props)} />
    </QueryClientProvider>,
  );
}

describe('the draft rail', () => {
  it.each([{}, { canEdit: false }])('renders none of the removed sections (%o)', (props) => {
    const { container } = renderRail(props);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Checks/);
    expect(text).not.toMatch(/AI judge/i);
    expect(text).not.toMatch(/issues? to look at/i);
    expect(text).not.toMatch(/Adjust the AI/i);
    expect(text).not.toMatch(/Validation/);
    expect(text).not.toMatch(/\d+\/\d+/); // no "6/8" score
    expect(text).not.toMatch(/Decision on this draft/i);
    expect(text).not.toMatch(/Notes/);
  });

  it('offers no decision, override or shortcut legend', () => {
    renderRail();
    expect(screen.queryByRole('button', { name: /Approve|Reject|anyway|Keyboard shortcuts/i })).toBeNull();
    expect(document.querySelector('[aria-pressed], dl kbd, [aria-current]')).toBeNull();
  });

  it('keeps History', () => {
    renderRail();
    expect(screen.getByRole('button', { name: /History/ })).toBeInTheDocument();
  });
});

describe('the page shortcuts', () => {
  it.each(['j', 'k', 'a', 'x', 'r', '?'])('no longer bind %s', (key) => {
    expect(draftShortcut(key)).toBeNull();
  });

  it('still step the queue with [ and ]', () => {
    expect(draftShortcut(']')).toEqual({ kind: 'queue', delta: 1 });
    expect(draftShortcut('[')).toEqual({ kind: 'queue', delta: -1 });
  });

  it('ignores keys that only exist on the prototype', () => {
    expect(draftShortcut('constructor')).toBeNull();
  });
});
