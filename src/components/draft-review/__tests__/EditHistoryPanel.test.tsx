/**
 * The edit log has to REACH THE SCREEN, and it has to reach it collapsed
 * (bd startsim-j9rxf).
 *
 * lib/edit-history's own tests pin the folding rule. What they cannot see is the
 * half that actually fails in practice: whether the rail renders the log at all,
 * whether it names the person, and whether a sitting that swallowed twelve
 * autosaves still SAYS it swallowed twelve — a bare timestamp over a collapse
 * claims a precision the entry does not have.
 *
 * These render the WHOLE QualityRail rather than the panel in isolation, because
 * the wiring is the part that can silently disappear: a panel that renders
 * beautifully but is never mounted is the failure mode a component-in-isolation
 * test is blind to.
 */
import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QualityRail, type QualityRailProps } from '../QualityRail';
import { COLLAPSE_WINDOW_MS, type EditEntry } from '@/lib/edit-history';

const ADA = 'ada@startsimpli.com';
const GRACE = 'grace@startsimpli.com';

const BASE = Date.parse('2026-09-09T10:00:00.000Z');
const at = (ms: number) => new Date(BASE + ms).toISOString();

const noop = () => {};

function railProps(editHistory: EditEntry[]): QualityRailProps {
  return {
    checks: [],
    stops: [],
    activeStop: -1,
    onJumpToCheck: noop,
    legendOpen: false,
    onToggleLegend: noop,
    judgeVerdictWord: '',
    override: { overridden: false },
    onOverride: noop,
    review: {},
    onReviewChange: noop,
    feedbackReady: false,
    canAccept: false,
    acceptGateHint: null,
    notes: [],
    onAddNote: noop,
    onResolveNote: noop,
    noteSection: 'general',
    onNoteSectionChange: noop,
    noteSections: ['general'],
    editHistory,
    chain: [],
    currentId: '1',
    parentId: '',
    showDiff: false,
    onToggleDiff: noop,
    blogDiff: '',
    parentLoading: false,
    parentError: false,
    onRefreshParent: noop,
  };
}

/** Render the rail and open the Edit history panel, returning its body. */
function openPanel(editHistory: EditEntry[]): HTMLElement {
  render(<QualityRail {...railProps(editHistory)} />);
  fireEvent.click(screen.getByRole('button', { name: /Edit history/i }));
  return screen.getByTestId('activity-timeline');
}

describe('Edit history in the Quality rail', () => {
  it('is mounted in the rail — collapsed, with the entry count on the header', () => {
    render(
      <QualityRail
        {...railProps([
          { by: ADA, from: at(0), at: at(0), saves: 1 },
          { by: GRACE, from: at(600_000), at: at(600_000), saves: 1 },
        ])}
      />,
    );
    const header = screen.getByRole('button', { name: /Edit history/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveTextContent('2');
  });

  it('names WHO edited it — the email, which is the identity a reader can resolve', () => {
    const body = openPanel([{ by: ADA, from: at(0), at: at(0), saves: 1 }]);
    expect(within(body).getByText(ADA)).toBeInTheDocument();
  });

  it('shows ONE row for a debounced burst, and says it collapsed twelve saves', () => {
    // The failure this guards: twelve rows of near-identical timestamps.
    const body = openPanel([{ by: ADA, from: at(0), at: at(240_000), saves: 12 }]);
    expect(within(body).getAllByText('Edited')).toHaveLength(1);
    expect(within(body).getByText('12 saves over 4 min')).toBeInTheDocument();
  });

  it('lists the newest sitting first — "who touched this last" is the question', () => {
    const body = openPanel([
      { by: ADA, from: at(0), at: at(0), saves: 1 },
      { by: GRACE, from: at(COLLAPSE_WINDOW_MS * 2), at: at(COLLAPSE_WINDOW_MS * 2), saves: 1 },
    ]);
    const people = within(body)
      .getAllByText(/@startsimpli\.com/)
      .map((n) => n.textContent);
    expect(people).toEqual([GRACE, ADA]);
  });

  it('renders an unattributed edit as an edit, not as a person with a blank name', () => {
    const body = openPanel([{ from: at(0), at: at(0), saves: 1 }]);
    expect(within(body).getByText('Edited')).toBeInTheDocument();
    expect(within(body).queryByText(/@/)).not.toBeInTheDocument();
  });

  it('says nobody has edited it rather than showing an empty box', () => {
    const body = openPanel([]);
    expect(within(body).getByText(/No edits yet/i)).toBeInTheDocument();
  });

  it('does NOT offer a diff — that is the deferred feature (bd startsim-b3twa)', () => {
    // Revision history owns the AI-revision diff; this panel must never grow one.
    render(<QualityRail {...railProps([{ by: ADA, from: at(0), at: at(0), saves: 3 }])} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit history/i }));
    expect(screen.queryByRole('button', { name: /compare|diff/i })).not.toBeInTheDocument();
  });
});
