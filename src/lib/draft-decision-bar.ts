/**
 * What the decision bar on /draft/<id> says and does, from the rail's decision
 * (locked decision #2): ONE primary action driven by the reviewer's verdict.
 * approve → Approve draft (gated), reject → Reject draft, none → a disabled
 * "Choose a decision".
 *
 * A stored verdict the rail no longer offers — 'revise', from the removed
 * "Request changes" (bd startsim-m7fdm.24) — counts as undecided: the button is
 * the disabled "Choose a decision", and the hint names the stored value raw so
 * the reviewer sees what is on the record without it being dressed up as a
 * current decision. Nothing here rewrites it.
 *
 * Pure, so it tests without rendering the page.
 */
import { draftDecisionLabel, isOfferedDraftDecision } from '@/lib/review-vocabulary';

export interface DecisionBarInput {
  /** The stored review verdict, as read off the draft (may be a legacy value). */
  call: string | undefined;
  isApproved: boolean;
  isSent: boolean;
  acceptGateHint: string | null;
  validationOk: boolean;
  /** Whether the approved-source check could not run. */
  sourceGap: boolean;
  accepting: boolean;
  rejecting: boolean;
  canAccept: boolean;
}

export interface DecisionBarState {
  gateText: string | null;
  gateWarn: boolean;
  /** False once the draft is approved or sent — the bar shows "Mark sent" instead. */
  showPrimary: boolean;
  primaryLabel: string;
  primaryDisabled: boolean;
  primaryVariant: 'default' | 'destructive';
}

export function draftDecisionBar(i: DecisionBarInput): DecisionBarState {
  const done = i.isApproved || i.isSent;
  const call = isOfferedDraftDecision(i.call) ? i.call : undefined;
  const legacy = !call && !!i.call;

  const gateText = done
    ? null
    : legacy
      ? `This draft carries an earlier decision (“${i.call}”) that is no longer offered — choose a decision`
      : !call
        ? 'Choose a decision'
        : call === 'approve'
          ? i.acceptGateHint ?? 'Ready to approve this draft'
          : 'This candidate will be dropped';

  const primaryLabel =
    call === 'approve'
      ? i.accepting
        ? 'Approving…'
        : draftDecisionLabel('approve')
      : call === 'reject'
        ? i.rejecting
          ? 'Rejecting…'
          : draftDecisionLabel('reject')
        : 'Choose a decision';

  return {
    gateText,
    gateWarn: call === 'approve' ? !i.validationOk || i.sourceGap : false,
    showPrimary: !done,
    primaryLabel,
    primaryDisabled: !call || i.accepting || i.rejecting || (call === 'approve' && !i.canAccept),
    primaryVariant: call === 'reject' ? 'destructive' : 'default',
  };
}
