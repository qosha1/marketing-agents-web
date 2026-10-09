/**
 * RED for bd startsim-b313v — two different decisions both say "approve".
 *
 * Malin, having clicked into a topic: "so if I go, I click approve now, does it
 * approve all of them?" The question is only askable because approving a TOPIC
 * and approving a DRAFT are rendered with identical copy.
 */
import { describe, it, expect } from 'vitest';
import { resolveReviewConfig, reviewDecisions } from '@startsimpli/ui/collection';

import {
  TOPIC_ACTIONS_HEADER,
  TOPIC_DECISION_LABELS,
} from '@/lib/review-vocabulary';
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

describe('the topic decision names its subject', () => {
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
   * is the signal to supply OGMC's topic copy here (bd startsim-b313v.1).
   *
   * SCOPED TO approve + reject, which are the two b313v.1 will override. Asking
   * this of every decision would include `needs_work`, whose label stays "Needs
   * work" — so the marker would never fire, and a dead man's switch with the
   * batteries out is worse than none.
   */
  it.fails('will name its subject once @startsimpli/ui takes label overrides', () => {
    const byKey = Object.fromEntries(
      reviewDecisions(resolveReviewConfig(TOPIC_TYPE)).map((d) => [d.key, d.label]),
    );
    expect(/topic/i.test(byKey.approve) && /topic/i.test(byKey.reject)).toBe(true);
  });
});

describe('TOPIC_DECISION_LABELS', () => {
  it('names the subject on both terminal decisions, matching the draft side', () => {
    // The draft page said "Approve draft" / "Reject draft" until its decision
    // was removed (bd startsim-m7fdm.25); the topic side still names its subject.
    expect(TOPIC_DECISION_LABELS.approve).toBe('Approve topic');
    expect(TOPIC_DECISION_LABELS.reject).toBe('Reject topic');
  });

  it('leaves needs_work generic so the resolver keeps its default', () => {
    expect(TOPIC_DECISION_LABELS.needs_work).toBeUndefined();
  });

  it('renames ACTIONS, never statuses — wn2p.3 owns the status vocabulary', () => {
    // A status name in a button label is how the two vocabularies drift, and
    // OGMC still owes us the combined column list.
    const words = Object.values(TOPIC_DECISION_LABELS).join(' ').toLowerCase();
    for (const status of ['suggested', 'ready', 'written', 'rejected']) {
      expect(words).not.toContain(status);
    }
  });
});
