/**
 * RED for bd startsim-b313v — two different decisions both say "approve".
 *
 * Malin, having clicked into a topic: "so if I go, I click approve now, does it
 * approve all of them?" The question is only askable because approving a TOPIC
 * and approving a DRAFT are rendered with identical copy.
 */
import { describe, it, expect } from 'vitest';
import { resolveReviewConfig, reviewDecisions } from '@startsimpli/ui/collection';

import { DRAFT_DECISIONS, draftDecisionLabel, TOPIC_ACTIONS_HEADER } from '@/lib/review-vocabulary';
import type { EntityTypeDef } from '@/lib/foundry-api';

/** The live topic schema's status enum, as `resolveReviewConfig` reads it. */
const TOPIC_TYPE = {
  id: 't',
  key: 'topic',
  label: 'Topic',
  attributes: [
    {
      id: 'a',
      name: 'status',
      dataType: 'enum' as const,
      required: false,
      config: { choices: ['suggested', 'ready', 'written', 'rejected'] },
    },
  ],
} satisfies EntityTypeDef;

const topicLabels = () => reviewDecisions(resolveReviewConfig(TOPIC_TYPE)).map((d) => d.label);

describe('the draft decision names what it decides', () => {
  it('says "draft" on the two decisions that dispose of the piece', () => {
    expect(draftDecisionLabel('approve')).toBe('Approve draft');
    expect(draftDecisionLabel('reject')).toBe('Reject draft');
  });

  it('leaves "Request changes" alone — it is already unambiguous', () => {
    expect(draftDecisionLabel('revise')).toBe('Request changes');
  });
});

describe('the two decisions are no longer the same word', () => {
  it('shares no label between the topic decision and the draft decision', () => {
    const shared = DRAFT_DECISIONS.map((d) => d.label).filter((l) => topicLabels().includes(l));
    expect(shared).toEqual([]);
  });

  it('names the subject over the table’s inline decision cluster', () => {
    // The cluster used to sit under a blank header, so a row of tick/cross
    // buttons on the Topics table said nothing about what it decided.
    expect(TOPIC_ACTIONS_HEADER).toMatch(/topic/i);
  });
});

describe('the SHARED half, which this fork cannot fix yet', () => {
  /**
   * `reviewDecisions()` in @startsimpli/ui hardcodes 'Approve' / 'Needs work' /
   * 'Reject' and `ReviewConfig` has no label hook — so the button Malin actually
   * pressed still carries a generic verb, and no tenant can supply its own
   * vocabulary. That is the real bug, and the fix is a separate PR against
   * packages/ui in the start-simpli meta-repo (this repo consumes the PUBLISHED
   * package, so it cannot consume the new field until it ships).
   *
   * `it.fails` on purpose: this passes while the shared label is still generic,
   * and turns RED the moment the published package can name its subject — which
   * is the signal to supply OGMC's topic copy here.
   */
  it.fails('will name its subject once @startsimpli/ui takes label overrides', () => {
    expect(topicLabels().every((l) => /topic/i.test(l))).toBe(true);
  });
});
