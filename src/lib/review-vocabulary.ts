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
