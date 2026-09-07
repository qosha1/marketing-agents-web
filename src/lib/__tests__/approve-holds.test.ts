/**
 * Approving a topic leaves you standing on the topic you approved
 * (bd startsim-t1t1k).
 *
 * Malin, verbatim: "To create a draft, you first have to approve the Topic,
 * then click out of the window, refresh the page, filter the 'Ready' topics,
 * find the same topic, click approve again and then it generates drafts. There
 * is a glitch in the flow somewhere."
 *
 * Six steps to reach a button that should have been one. The second approve is
 * a no-op on the data — what the reload actually bought was a FRESH RECORD —
 * and two mechanisms in the shared drawer produced that together:
 *
 *   • it auto-advanced after Approve, so the newly-legal "Generate drafts"
 *     control appeared under the NEXT topic; and
 *   • it handed `renderExtra` the untouched `record` prop while rendering
 *     everything else from the decision it had just applied, so the gate went
 *     on reading the pre-approval status even when you stayed put.
 *
 * Both are fixed in @startsimpli/ui 0.4.113 and pinned there
 * (collection/__tests__/approve-unlocks.test.tsx). What is OURS is the
 * declaration that the topic decision has a follow-on at all — a package
 * default cannot know that — so this file pins the declaration and the
 * consequence the reviewer actually cares about.
 */
import { describe, expect, it } from 'vitest';

import {
  applyDecisionToData,
  resolveReviewConfig,
  reviewDecisions,
} from '@startsimpli/ui/collection';

import { TOPIC_REVIEW_CONFIG } from '@/lib/review-vocabulary';
import { canGenerateDrafts } from '@/lib/topic-drafts';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const TOPIC_TYPE: EntityTypeDef = {
  id: 'type-topic',
  key: 'topic',
  label: 'Topic',
  attributes: [
    {
      id: 'a1',
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'written', 'rejected'] },
    },
    { id: 'a2', name: 'team_verdict', dataType: 'text', required: false, config: {} },
  ],
};

const cfg = resolveReviewConfig(TOPIC_TYPE, TOPIC_REVIEW_CONFIG);
const decisions = reviewDecisions(cfg);
const byKey = Object.fromEntries(decisions.map((d) => [d.key, d]));

const TOPIC: EntityRecord = {
  id: 7,
  entityType: 'topic',
  externalId: null,
  name: 'Desalination in Riyadh',
  data: { status: 'suggested' },
  createdAt: '2026-09-01T00:00:00Z',
};

describe('the topic decision declares that approving has a follow-on', () => {
  it('does not move the queue on after Approve', () => {
    expect(byKey.approve.advance).toBe(false);
  });

  it('still moves on after Reject — nothing follows a rejection', () => {
    expect(byKey.reject.advance).toBe(true);
  });

  it('holds the queue WITHOUT changing what Approve writes', () => {
    const plain = reviewDecisions(resolveReviewConfig(TOPIC_TYPE));
    const held = byKey.approve;
    const generic = plain.find((d) => d.key === 'approve');
    expect([held.status, held.verdict]).toEqual([generic?.status, generic?.verdict]);
    expect([held.status, held.verdict]).toEqual(['ready', 'good']);
  });
});

describe('one approve is enough to reach the writer', () => {
  it('opens the gate on the FIRST approve, with no reload and no second click', () => {
    // Step 1 — the reviewer approves.
    const afterFirst = { ...TOPIC, data: applyDecisionToData(TOPIC.data, byKey.approve, cfg) };
    expect(canGenerateDrafts(afterFirst, cfg, 0)).toEqual({ allowed: true });

    // The six-step workaround's steps 2-6 were: close, reload, filter to Ready,
    // find it again, approve again. The second approve is a no-op on the data,
    // which is why the reload — not the click — was doing the work.
    const afterSecond = applyDecisionToData(afterFirst.data, byKey.approve, cfg);
    expect(afterSecond).toEqual(afterFirst.data);
  });

  it('refuses in WORDS before the approve, never with a silent dead control', () => {
    const gate = canGenerateDrafts(TOPIC, cfg, 0);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.message).toBe('Approve this topic to generate drafts.');
  });
});
