/**
 * The draft page's decision bar, with "Request changes" removed
 * (bd startsim-m7fdm.24).
 *
 * The bar used to hide its primary button entirely for a 'revise' verdict and
 * talk about "changes requested". Now only Approve draft and Reject draft are
 * offered; a draft that still carries 'revise' is treated as undecided: the
 * button reads "Choose a decision" and is disabled, and the hint names the
 * stored value raw instead of pretending it is a current decision.
 */
import { describe, expect, it } from 'vitest';

import { draftDecisionBar, type DecisionBarInput } from '@/lib/draft-decision-bar';

function input(overrides: Partial<DecisionBarInput> = {}): DecisionBarInput {
  return {
    call: undefined,
    isApproved: false,
    isSent: false,
    acceptGateHint: null,
    validationOk: true,
    sourceGap: false,
    accepting: false,
    rejecting: false,
    canAccept: false,
    ...overrides,
  };
}

describe('draftDecisionBar', () => {
  it('asks for a decision when there is none', () => {
    const bar = draftDecisionBar(input());
    expect(bar.gateText).toBe('Choose a decision');
    expect(bar.primaryLabel).toBe('Choose a decision');
    expect(bar.primaryDisabled).toBe(true);
    expect(bar.showPrimary).toBe(true);
  });

  it('approves when approve is chosen and Accept is unlocked', () => {
    const bar = draftDecisionBar(input({ call: 'approve', canAccept: true }));
    expect(bar.primaryLabel).toBe('Approve draft');
    expect(bar.primaryDisabled).toBe(false);
    expect(bar.gateText).toBe('Ready to approve this draft');
  });

  it('rejects when reject is chosen', () => {
    const bar = draftDecisionBar(input({ call: 'reject' }));
    expect(bar.primaryLabel).toBe('Reject draft');
    expect(bar.primaryVariant).toBe('destructive');
    expect(bar.primaryDisabled).toBe(false);
  });

  it('treats a stored "revise" as undecided and names it raw', () => {
    const bar = draftDecisionBar(input({ call: 'revise' }));
    expect(bar.showPrimary).toBe(true);
    expect(bar.primaryLabel).toBe('Choose a decision');
    expect(bar.primaryDisabled).toBe(true);
    expect(bar.gateText).toContain('revise');
    expect(bar.gateText).not.toMatch(/Request changes|Changes requested/i);
  });

  it('shows no decision once the draft is approved or sent', () => {
    expect(draftDecisionBar(input({ isApproved: true, call: 'revise' })).gateText).toBeNull();
    expect(draftDecisionBar(input({ isSent: true })).showPrimary).toBe(false);
  });
});
