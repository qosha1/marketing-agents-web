/**
 * What each review decision is a decision ABOUT (bd startsim-b313v).
 *
 * THE COLLISION. Malin, mid-walkthrough, having clicked into a topic: "so if I
 * go, I click approve now, does it approve all of them?" Then, in the draft, the
 * same word again. Two controls, identical copy, and nothing on either says what
 * it acts on.
 *
 * THE MODEL the labels have to make obvious without explanation:
 *   • TOPIC decision — this subject is worth writing. Approving it unlocks the
 *     writer. It says nothing about any text.
 *   • DRAFT decision — this piece of content is publishable. It is the editorial
 *     disposition from the tracker workflow, and is about to become four-valued
 *     (Approved / Rejected / Not for publication now / For repurpose, wn2p).
 *
 * They are not two instances of one verb; they are different KINDS of decision.
 * So each label names its subject.
 *
 * STATUSES ARE NOT RENAMED HERE — only actions. The status vocabulary is
 * startsim-wn2p.3's, OGMC owes a combined column vocabulary, and inventing a
 * status name in a button label is how the two drift apart.
 */

import type { ReviewConfig } from '@startsimpli/ui/collection';

export interface DecisionLabel {
  /** Stable id — the verdict value persisted on the record. */
  id: string;
  label: string;
}

/**
 * The DRAFT decision (the quality rail + the decision bar on /draft/<id>).
 *
 * "Request changes" needs no subject: it is already unambiguous, and nothing on
 * the topic side says anything like it.
 */
export const DRAFT_DECISIONS: DecisionLabel[] = [
  { id: 'approve', label: 'Approve draft' },
  { id: 'revise', label: 'Request changes' },
  { id: 'reject', label: 'Reject draft' },
];

/** The draft decision's label by verdict id. */
export function draftDecisionLabel(id: string): string {
  return DRAFT_DECISIONS.find((d) => d.id === id)?.label ?? '';
}

/**
 * The header over a table's inline decision cluster — the other half of the same
 * fix. The cluster used to render under a blank header, so a row of ✓/✕ buttons
 * on the Topics table said nothing about what it decided.
 */
export const TOPIC_ACTIONS_HEADER = 'Topic decision';
export const NEWS_ACTIONS_HEADER = 'Curation';

/**
 * The TOPIC decision's button labels, supplied to `resolveReviewConfig` via
 * `ReviewConfig.decisionLabels` (@startsimpli/ui 0.4.110, bd startsim-b313v).
 *
 * Until that field existed the three labels were string literals inside the
 * shared `reviewDecisions()`, so every tenant's every reviewable type said
 * "Approve" — which is the collision this module opens by describing. The header
 * above was the half we could fix locally; this is the half that needed the
 * package.
 *
 * `needs_work` is deliberately absent: it keeps the generic wording. It is
 * already unambiguous, it has no counterpart on the draft side to be confused
 * with, and naming a subject on it would be noise. An unnamed decision keeps its
 * default rather than going blank — the shared resolver guarantees that.
 */
export const TOPIC_DECISION_LABELS: Record<string, string> = {
  approve: 'Approve topic',
  reject: 'Reject topic',
};

/**
 * THE topic review config — one object, imported by every surface that lets a
 * human decide a topic (bd startsim-6y458).
 *
 * It used to be a `const` inside the Topics TABLE page, which is why the board
 * had no decision at all: there was nothing for a second surface to import, and
 * a copy-pasted second literal would have been one careless edit away from the
 * drift this config exists to prevent. Approving a topic writes TWO fields with
 * two different consumers — `status`, the pipeline gate the writer and
 * `canGenerateDrafts` key off, and `team_verdict`, the signal the n8n re-rank
 * agent turns back INTO status. A surface that wrote one without the other
 * would look right on screen and silently desynchronise them.
 *
 * So both surfaces resolve this same object through the shared
 * `resolveReviewConfig` and hand it to the shared `InlineReviewActions`. The
 * statuses stay derived from the type's own enum — startsim-wn2p.3's to rename,
 * never re-declared here.
 */
export const TOPIC_REVIEW_CONFIG: ReviewConfig = {
  decisionLabels: TOPIC_DECISION_LABELS,
  /**
   * APPROVING A TOPIC IS NOT THE END OF THE JOB, so the drawer stays on it
   * (@startsimpli/ui 0.4.113, bd startsim-t1t1k).
   *
   * Approving is precisely what makes "Generate drafts" legal for that topic.
   * The drawer used to auto-advance, so the control the approval had just
   * unlocked appeared under the NEXT topic, and the reviewer's route to a draft
   * became: approve, close the drawer, reload, filter to Ready, find the same
   * topic, approve it a second time. Six steps, and the second approve wrote
   * nothing — what the reload bought was a fresh record.
   *
   * Only 'approve' is held. Rejecting a topic has no follow-on, so it still
   * advances and fast triage keeps its rhythm; moving on from an approved topic
   * is one press of j.
   */
  holdAfter: ['approve'],
};

/**
 * News curation: a binary Accept (→ acceptable, the gate before topic
 * generation) / Reject (→ rejected). No verdict and no "needs work" — that type
 * declares no `team_verdict`, and only `acceptable` news is fed to the n8n
 * topic strategist.
 */
export const NEWS_REVIEW_CONFIG: ReviewConfig = {
  approveStatus: 'acceptable',
  rejectStatus: 'rejected',
  verdicts: [],
  omitNeedsWork: true,
};
