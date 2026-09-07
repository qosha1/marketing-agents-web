/**
 * The board decides the same way the table decides (bd startsim-6y458).
 *
 * Malin, item 4: "Topic approval flow on Board view is different than Table
 * view; on Board view there is no option to approve/reject. We can change
 * status or drag the topic to another column."
 *
 * The danger in fixing that is not the missing buttons — it is fixing them
 * WRONG. Approving a topic writes two fields with two different consumers:
 *
 *   • `status`       — the pipeline gate. The writer keys off it, and so does
 *                      `canGenerateDrafts`.
 *   • `team_verdict` — the signal the n8n re-rank agent turns INTO status
 *                      (`good` → ready, `bad` → rejected).
 *
 * A board that wrote only one of them would look correct on screen and quietly
 * desynchronise the two. So the board does not get its own decision path: it
 * reaches the same `applyDecisionToData` through the same config object the
 * table uses, and this file pins that the object produces the coherent pair.
 *
 * The last block is the deliberate exception, written down rather than assumed:
 * a lane MOVE (a drag, or the per-card status select) stays status-only.
 */
import { describe, expect, it } from 'vitest';

import {
  applyDecisionToData,
  resolveReviewConfig,
  reviewDecisions,
  type ReviewDecision,
} from '@startsimpli/ui/collection';

import { laneMoveData } from '@/lib/board';
import { NEWS_REVIEW_CONFIG, TOPIC_REVIEW_CONFIG } from '@/lib/review-vocabulary';
import { canGenerateDrafts } from '@/lib/topic-drafts';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/** The topic spine as the tenant declares it. */
const TOPIC_TYPE: EntityTypeDef = {
  id: 'type-topic',
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 'a1', name: 'title', dataType: 'text', required: false, config: {} },
    {
      id: 'a2',
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'written', 'rejected'] },
    },
    { id: 'a3', name: 'team_verdict', dataType: 'text', required: false, config: {} },
  ],
};

const NEWS_TYPE: EntityTypeDef = {
  id: 'type-news',
  key: 'news_item',
  label: 'News item',
  attributes: [
    {
      id: 'n1',
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['new', 'acceptable', 'rejected'] },
    },
  ],
};

function topic(data: Record<string, unknown>): EntityRecord {
  return {
    id: 42,
    entityType: 'topic',
    externalId: null,
    name: 'Desalination in Riyadh',
    data,
    createdAt: '2026-09-01T00:00:00Z',
  };
}

const topicCfg = resolveReviewConfig(TOPIC_TYPE, TOPIC_REVIEW_CONFIG);
const topicDecisions = reviewDecisions(topicCfg);

function decision(key: string): ReviewDecision {
  const d = topicDecisions.find((x) => x.key === key);
  if (!d) throw new Error(`no "${key}" decision resolved for the topic type`);
  return d;
}

describe('the topic review config is ONE object, and it writes the pair', () => {
  it('approves by writing the pipeline gate AND the re-rank signal together', () => {
    const before = topic({ title: 'x', status: 'suggested' });
    const after = applyDecisionToData(before.data, decision('approve'), topicCfg);
    // camelCase: the tenant client camelises the data blob, and toCamelKey
    // follows it — see @startsimpli/ui/collection's `data.ts`.
    expect(after).toMatchObject({ status: 'ready', teamVerdict: 'good' });
  });

  it('rejects the same way — neither field moves without the other', () => {
    const after = applyDecisionToData({ status: 'suggested' }, decision('reject'), topicCfg);
    expect(after).toMatchObject({ status: 'rejected', teamVerdict: 'bad' });
  });

  it('names what is being decided, so a board card cannot say a different word', () => {
    const byKey = Object.fromEntries(topicDecisions.map((d) => [d.key, d.label]));
    expect(byKey.approve).toBe('Approve topic');
    expect(byKey.reject).toBe('Reject topic');
  });

  it('curates news with a status move alone — that type declares no verdict', () => {
    const cfg = resolveReviewConfig(NEWS_TYPE, NEWS_REVIEW_CONFIG);
    const byKey = Object.fromEntries(reviewDecisions(cfg).map((d) => [d.key, d]));
    expect(byKey.approve.status).toBe('acceptable');
    expect(byKey.approve.verdict).toBeNull();
    expect(byKey.needs_work).toBeUndefined(); // binary accept/reject
  });
});

describe('a decision made on the board is a decision the writer gate honours', () => {
  it('unlocks Generate drafts for the topic that was just approved', () => {
    const before = topic({ title: 'x', status: 'suggested' });

    // Before the decision the gate refuses, in words.
    const refused = canGenerateDrafts(before, topicCfg, 0);
    expect(refused).toEqual({
      allowed: false,
      reason: 'not_approved',
      message: 'Approve this topic to generate drafts.',
    });

    // The board's Approve writes exactly what the gate reads.
    const decided = { ...before, data: applyDecisionToData(before.data, decision('approve'), topicCfg) };
    expect(canGenerateDrafts(decided, topicCfg, 0)).toEqual({ allowed: true });
  });

  it('still refuses a topic whose drafts already exist, approved or not', () => {
    const decided = { ...topic({ status: 'suggested' }) };
    decided.data = applyDecisionToData(decided.data, decision('approve'), topicCfg);
    expect(canGenerateDrafts(decided, topicCfg, 3).allowed).toBe(false);
  });
});

/**
 * DRAGGING A CARD IS NOT A VERDICT — the deliberate answer bd startsim-6y458
 * asks for, pinned so a later "helpful" change has to argue with a test.
 *
 * A drag says "put this in that lane". It does not say "I judge this good", and
 * three things follow from that:
 *   • lanes like `written` and Unset have no verdict that corresponds to them,
 *     so a lane-derived verdict would have to be invented for some lanes;
 *   • `team_verdict` is the re-rank agent's INPUT, so synthesising one from a
 *     lane move feeds the agent a judgement no human made;
 *   • the reverse drag would have to invent a value meaning "un-judged".
 * A stale-but-honest verdict beats a fabricated one. Reviewers who mean to
 * judge use the decision buttons, which are now on the card.
 */
describe('a lane move writes the status and only the status', () => {
  it('leaves an existing verdict untouched', () => {
    const data = { title: 'x', status: 'suggested', teamVerdict: 'good' };
    expect(laneMoveData(data, 'status', 'written')).toEqual({
      title: 'x',
      status: 'written',
      teamVerdict: 'good',
    });
  });

  it('does not invent a verdict for a record that has none', () => {
    const moved = laneMoveData({ title: 'x', status: 'suggested' }, 'status', 'ready');
    expect(moved).toEqual({ title: 'x', status: 'ready' });
    expect('teamVerdict' in moved).toBe(false);
  });

  it('writes the camelised key the data blob actually uses', () => {
    expect(laneMoveData({}, 'review_status', 'ready')).toEqual({ reviewStatus: 'ready' });
  });
});
