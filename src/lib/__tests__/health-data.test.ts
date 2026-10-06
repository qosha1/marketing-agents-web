import { describe, it, expect } from 'vitest';

import {
  applyDraftQueue,
  applyTopicQueue,
  awaitsDraftDecision,
  clearedTopicQueue,
  draftQueue,
  draftQueueChips,
  ingestionOverdue,
  ingestionSummary,
  intakeStage,
  isJudgedNotFiled,
  isUnjudged,
  queueTotal,
  TOPIC_QUEUE_PARAM,
  topicPipeline,
  topicQueue,
  topicQueueChips,
} from '../health-data';
import type { AttributeDef, EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

const statusAttr: AttributeDef = {
  id: '1', name: 'status', dataType: 'enum', required: false,
  config: { choices: ['suggested', 'ready', 'rejected', 'written'] },
};
const topicType: EntityTypeDef = {
  id: 't', key: 'topic', label: 'Topic', attributes: [statusAttr],
};

function topic(id: number, data: Record<string, unknown>, createdAt = '2026-07-01'): EntityRecord {
  return { id, entityType: 'topic', externalId: null, name: `Topic ${id}`, data, createdAt };
}
function news(id: number, createdAt: string, data: Record<string, unknown> = {}): EntityRecord {
  return { id, entityType: 'news_item', externalId: null, name: `News ${id}`, data, createdAt };
}
function source(id: number, name: string, domain?: string): EntityRecord {
  return {
    id, entityType: 'source', externalId: null, name,
    data: domain ? { domain } : {}, createdAt: '2026-07-01',
  };
}

describe('topicPipeline', () => {
  it('counts records per status stage', () => {
    const records = [
      topic(1, { status: 'suggested' }),
      topic(2, { status: 'suggested' }),
      topic(3, { status: 'ready' }),
      topic(4, { status: 'written' }),
    ];
    expect(topicPipeline(topicType, records).stages).toEqual([
      { label: 'suggested', count: 2 },
      { label: 'ready', count: 1 },
      { label: 'rejected', count: 0 },
      { label: 'written', count: 1 },
    ]);
  });

  it('drops the Unset lane unless something lands there, and keeps it when it does', () => {
    const clean = topicPipeline(topicType, [topic(1, { status: 'ready' })]);
    expect(clean.stages.map((s) => s.label)).not.toContain('Unset');

    const dirty = topicPipeline(topicType, [topic(1, { status: 'bogus' }), topic(2, {})]);
    expect(dirty.stages.find((s) => s.label === 'Unset')?.count).toBe(2);
  });

  it('returns empty when the type has no status enum', () => {
    expect(topicPipeline(null, [topic(1, { status: 'ready' })])).toEqual({ stages: [] });
  });

  it('does not expose an "attention" count — the queue owns that claim', () => {
    const result = topicPipeline(topicType, [topic(1, { status: 'suggested' })]) as Record<string, unknown>;
    expect(result.attention).toBeUndefined();
  });
});

describe('intakeStage', () => {
  it('is the FIRST declared choice of the status enum, not a hardcoded value', () => {
    expect(intakeStage(topicType)).toBe('suggested');
  });

  it('follows a fork that renamed or reordered its intake stage', () => {
    const renamed: EntityTypeDef = {
      ...topicType,
      attributes: [{ ...statusAttr, config: { choices: ['inbox', 'triaged', 'done'] } }],
    };
    expect(intakeStage(renamed)).toBe('inbox');
  });

  it('is null (not a guess) when the type declares no status enum', () => {
    expect(intakeStage(null)).toBeNull();
    expect(intakeStage({ id: 'x', key: 'topic', label: 'Topic', attributes: [] })).toBeNull();
  });
});

describe('queue predicates', () => {
  it('isJudgedNotFiled: a verdict was recorded but the status never left intake', () => {
    expect(isJudgedNotFiled(topic(1, { status: 'suggested', team_verdict: 'good' }), 'suggested')).toBe(true);
    // judged AND filed -> done, not queue work
    expect(isJudgedNotFiled(topic(2, { status: 'ready', team_verdict: 'good' }), 'suggested')).toBe(false);
    // in intake but nobody judged it -> a different predicate
    expect(isJudgedNotFiled(topic(3, { status: 'suggested' }), 'suggested')).toBe(false);
    // a blank verdict string is not a verdict
    expect(isJudgedNotFiled(topic(4, { status: 'suggested', team_verdict: '  ' }), 'suggested')).toBe(false);
  });

  it('isJudgedNotFiled reads the camelCased blob (the client camelCases team_verdict)', () => {
    expect(isJudgedNotFiled(topic(1, { status: 'suggested', teamVerdict: 'bad' }), 'suggested')).toBe(true);
  });

  it('isUnjudged: neither a verdict nor a teaching note', () => {
    expect(isUnjudged(topic(1, { status: 'suggested' }))).toBe(true);
    expect(isUnjudged(topic(2, { status: 'suggested', team_verdict: 'good' }))).toBe(false);
    expect(isUnjudged(topic(3, { status: 'suggested', team_notes: 'looks thin' }))).toBe(false);
  });
});

describe('topicQueue', () => {
  const live = [
    ...Array.from({ length: 11 }, (_, i) => topic(i, { status: 'suggested', team_verdict: 'good' })),
    ...Array.from({ length: 8 }, (_, i) => topic(100 + i, { status: 'suggested', team_verdict: 'bad' })),
    ...Array.from({ length: 4 }, (_, i) => topic(200 + i, { status: 'ready', team_verdict: 'good' })),
  ];

  it('states the judged-not-filed predicate with a true count and a filtered link', () => {
    const [row, ...rest] = topicQueue(topicType, live);
    expect(rest).toEqual([]);
    expect(row.id).toBe('judged-not-filed');
    expect(row.count).toBe(19);
    expect(row.label).toBe('Judged, not filed — 19 topics');
    expect(row.href).toBe('/t/topic?queue=judged-not-filed');
    // the fact the old widget got wrong: these already carry a verdict
    expect(row.meta).toContain('good 11');
    expect(row.meta).toContain('bad 8');
    expect(row.meta).toContain('suggested');
  });

  it('never claims topics are "awaiting a verdict" when every one of them has one', () => {
    for (const row of topicQueue(topicType, live)) {
      expect(row.label.toLowerCase()).not.toContain('awaiting verdict');
    }
  });

  it('groups the verdict breakdown by OBSERVED value — team_verdict is text, not an enum', () => {
    const [row] = topicQueue(topicType, [
      topic(1, { status: 'suggested', team_verdict: 'needs-angle' }),
      topic(2, { status: 'suggested', team_verdict: 'needs-angle' }),
      topic(3, { status: 'suggested', team_verdict: 'ship-it' }),
    ]);
    expect(row.meta).toContain('needs-angle 2');
    expect(row.meta).toContain('ship-it 1');
  });

  it('surfaces genuinely unjudged topics as their own predicate', () => {
    const rows = topicQueue(topicType, [
      topic(1, { status: 'suggested' }),
      topic(2, { status: 'suggested', team_verdict: 'good' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['judged-not-filed', 'unjudged']);
    expect(rows[1].label).toBe('Not yet judged — 1 topic');
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
  });

  it('carries the RECORD count per row, so a card badge never reports the row count', () => {
    // The feed block's default badge is `${items.length} to review` — with one
    // aggregate row that reads "1 to review" beside a row saying "19 topics".
    // queueTotal is the number a badge may actually stand behind.
    expect(queueTotal(topicQueue(topicType, live))).toBe(19);
    expect(queueTotal([])).toBe(0);
  });

  it('drops zero rows entirely — a queue never lists "0 topics awaiting X"', () => {
    expect(topicQueue(topicType, [topic(1, { status: 'ready', team_verdict: 'good' })])).toEqual([]);
  });

  it('follows a renamed intake stage with no code change', () => {
    const renamed: EntityTypeDef = {
      ...topicType,
      attributes: [{ ...statusAttr, config: { choices: ['inbox', 'done'] } }],
    };
    const [row] = topicQueue(renamed, [topic(1, { status: 'inbox', team_verdict: 'good' })]);
    expect(row.label).toBe('Judged, not filed — 1 topic');
    expect(row.href).toBe('/t/topic?queue=judged-not-filed');
  });

  it('omits the stranded row (rather than reporting 0) when no status enum is declared', () => {
    const rows = topicQueue(null, [topic(1, { status: 'suggested', team_verdict: 'good' })]);
    expect(rows.map((r) => r.id)).toEqual([]);
  });
});

/**
 * THE CARD'S NUMBER AND THE CARD'S DESTINATION, over one corpus (bd
 * startsim-8hgmq.14).
 *
 * THE DEFECT. Every card computed a TWO-PART predicate and linked to a URL that
 * carried at most ONE half, so the reader was handed a superset of the pile they
 * clicked. Measured live on marketing-agents 2026-09-07 and reproduced below
 * record for record:
 *
 *   "Judged, not filed — 20 topics"  ->  /t/topic?status=suggested  ->  42 rows
 *   "Not yet judged — 23 topics"     ->  /t/topic                   ->  84 rows
 *
 * The two cards are meant to be DISJOINT (20 + 23 = 43), yet the second link's
 * destination contained the first's rows as well.
 *
 * THE FIX IS ONE PREDICATE, NOT TWO IMPLEMENTATIONS. The href now names the
 * queue itself (`?queue=judged-not-filed`) and the destination runs the same
 * QUEUE_ROWS entry the count was taken over. Carrying both halves in the URL
 * was the alternative and was rejected: it needs a param for "team_verdict is
 * blank", which `__isnull` does NOT express (it answers "is there an Attribute
 * ROW" — 167 live news_item rows proved that distinction), and it leaves two
 * implementations of one predicate free to drift apart again.
 *
 * So the assertion that matters is the ROUND TRIP: take the href the card
 * renders, parse it the way the destination parses its URL, and require the
 * records that land to be EXACTLY the ones counted — by id, not merely by
 * length, since a wrong predicate can return a right-sized set.
 */
describe('the card counts and the card links over ONE predicate', () => {
  const ids = (rs: EntityRecord[]) => rs.map((r) => Number(r.id)).sort((a, b) => a - b);

  /**
   * The live topic corpus, record for record (tenant API, 2026-09-07):
   * 84 topics = 42 suggested + 26 written + 16 rejected, of which 20 are
   * judged-not-filed and 23 are unjudged. The unjudged 23 split 22 suggested +
   * 1 WRITTEN — measured, not assumed, and the reason the ids are laid out in
   * disjoint blocks below: each queue's expected membership is known by
   * construction rather than re-derived by the assertion.
   */
  const judgedNotFiled = Array.from({ length: 20 }, (_, i) =>
    topic(1000 + i, { status: 'suggested', team_verdict: i % 2 ? 'good' : 'bad' }),
  );
  const untouchedIntake = Array.from({ length: 22 }, (_, i) =>
    topic(2000 + i, { status: 'suggested' }),
  );
  const untouchedWritten = [topic(3000, { status: 'written' })];
  const rest = [
    ...Array.from({ length: 25 }, (_, i) =>
      topic(4000 + i, { status: 'written', team_verdict: 'good' }),
    ),
    ...Array.from({ length: 16 }, (_, i) =>
      topic(5000 + i, { status: 'rejected', team_verdict: 'bad' }),
    ),
  ];
  const live = [...judgedNotFiled, ...untouchedIntake, ...untouchedWritten, ...rest];

  /** Read the href the way the destination reads its own URL. */
  const paramsOf = (href: string) =>
    Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? ''));

  it('reproduces the live corpus, so the numbers below are the measured ones', () => {
    expect(live).toHaveLength(84);
    const rows = topicQueue(topicType, live);
    expect(rows.map((r) => [r.id, r.count])).toEqual([
      ['judged-not-filed', 20],
      ['unjudged', 23],
    ]);
  });

  it('lands on exactly the records it counted — by id, for every row', () => {
    const rows = topicQueue(topicType, live);
    expect(rows.length).toBeGreaterThan(0);
    const expected: Record<string, EntityRecord[]> = {
      'judged-not-filed': judgedNotFiled,
      unjudged: [...untouchedIntake, ...untouchedWritten],
    };
    for (const row of rows) {
      const landed = applyTopicQueue(live, paramsOf(row.href ?? ''), topicType);
      expect(landed).toHaveLength(row.count);
      expect(ids(landed)).toEqual(ids(expected[row.id]));
    }
  });

  it('sends the two cards to DISJOINT piles — the defect in one assertion', () => {
    const [judged, unjudged] = topicQueue(topicType, live).map((row) =>
      new Set(applyTopicQueue(live, paramsOf(row.href ?? ''), topicType).map((r) => r.id)),
    );
    expect([...judged].filter((id) => unjudged.has(id))).toEqual([]);
    // What the old hrefs did: ?status=suggested returned all 42 suggested and a
    // bare /t/topic returned all 84. Neither number is reachable now.
    expect(judged.size + unjudged.size).toBe(43);
  });

  it('follows a renamed intake stage all the way to the destination', () => {
    // The href no longer spells the intake stage out, so this is what keeps the
    // schema-driven property the old `/t/topic?status=inbox` assertion carried.
    const renamed: EntityTypeDef = {
      ...topicType,
      attributes: [{ ...statusAttr, config: { choices: ['inbox', 'done'] } }],
    };
    const records = [
      topic(1, { status: 'inbox', team_verdict: 'good' }),
      topic(2, { status: 'done', team_verdict: 'good' }),
    ];
    const [row] = topicQueue(renamed, records);
    expect(row.count).toBe(1);
    expect(ids(applyTopicQueue(records, paramsOf(row.href ?? ''), renamed))).toEqual([1]);
  });

  it('keeps a rejected-but-untouched topic in the pile it was counted in', () => {
    // Today's corpus has none — the one non-`suggested` unjudged topic is
    // `written`. But the destination COLLAPSES rejected rows out of the main
    // list, so the day a rejected topic carries neither verdict nor note, the
    // count and the visible list would disagree again. The gate selects it here;
    // t/[typeKey]/page.tsx stops collapsing while a queue is active.
    const withRejected = [...live, topic(9000, { status: 'rejected' })];
    const [, unjudged] = topicQueue(topicType, withRejected);
    expect(unjudged.count).toBe(24);
    expect(
      applyTopicQueue(withRejected, paramsOf(unjudged.href ?? ''), topicType).map((r) => r.id),
    ).toContain(9000);
  });

  it('narrows nothing, and chips nothing, for a queue value it does not recognise', () => {
    // The mirror of the board's `?status=bogus` rule: a param that is not a
    // queue never produced a chip and must not start now. Silently narrowing to
    // an empty table under no chip is the worse failure.
    expect(applyTopicQueue(live, { [TOPIC_QUEUE_PARAM]: 'nonsense' }, topicType)).toHaveLength(84);
    expect(topicQueueChips({ [TOPIC_QUEUE_PARAM]: 'nonsense' })).toEqual([]);
    expect(applyTopicQueue(live, {}, topicType)).toHaveLength(84);
    expect(topicQueueChips({})).toEqual([]);
  });

  it('renders the active queue as a chip that names the card it came from', () => {
    const [row] = topicQueue(topicType, live);
    const chips = topicQueueChips(paramsOf(row.href ?? ''));
    expect(chips).toEqual([
      { param: TOPIC_QUEUE_PARAM, value: clearedTopicQueue()[TOPIC_QUEUE_PARAM], label: 'Judged, not filed' },
    ]);
    // The chip's ✕ value must actually clear the gate, or the chip is a dead control.
    expect(applyTopicQueue(live, clearedTopicQueue(), topicType)).toHaveLength(84);
    expect(topicQueueChips(clearedTopicQueue())).toEqual([]);
  });
});

/**
 * THE DASHBOARD SEES DRAFTS (bd startsim-tkfzu).
 *
 * WHAT WAS WRONG. "What needs a human" counted TOPIC predicates and nothing
 * else, so with every topic judged it rendered `All clear — nothing is waiting
 * on a person` while drafts sat at `ready_for_review`. Measured on the live
 * tenant 2026-10-05: 169 drafts, 166 of them `ready_for_review` and 3
 * `approved`. The all-clear was false for 166 records.
 *
 * IT COMPOUNDS. /t/draft opens on a 7-day window (startsim-f4lac, deliberate
 * and honestly chipped), so a draft nobody reviews inside a week leaves the
 * Drafts tab AND was never on the Dashboard. Work aged OUT of view instead of
 * into it, and the one surface whose job is "is there work?" reported the result
 * as all clear.
 *
 * THE TRAP THIS BLOCK EXISTS TO PIN is startsim-8hgmq.14 in mirror image. A
 * draft row's destination is /t/draft, which applies THREE of its own gates. So
 * the href has to clear the two that would hide the counted rows (`topic`,
 * `since`), keep the one the count also applies (`made` — the test-draft gate),
 * and carry the status predicate as a queue the destination re-runs. The
 * round-trip assertion below is by id, not by length.
 *
 * STATUS MEMBERSHIP IS READ FROM THE SCHEMA, as everywhere else in this module.
 * The live draft enum declares eleven values — the seven of wn2p.2's vocabulary
 * plus the four legacy ones the migration left declared — so which of them this
 * tenant can even be IN is the schema's answer, not this file's.
 */
describe('the draft queue — drafts awaiting a human decision', () => {
  const draftStatusAttr: AttributeDef = {
    id: 'ds', name: 'status', dataType: 'enum', required: false,
    config: {
      choices: [
        'ready_for_review', 'under_review', 'approved', 'published', 'rejected',
        'not_for_publication', 'for_repurpose', 'drafting', 'ready', 'needs_revision', 'sent',
      ],
    },
  };
  const draftType: EntityTypeDef = {
    id: 'd', key: 'draft', label: 'Draft', attributes: [draftStatusAttr],
  };

  function draft(id: number, data: Record<string, unknown>, ownerSub = 'svc:n8n-ogmc'): EntityRecord {
    return {
      id, entityType: 'draft', externalId: null, name: `Draft ${id}`,
      data, createdAt: '2026-09-17', ownerSub,
    } as unknown as EntityRecord;
  }

  const ids = (rs: EntityRecord[]) => rs.map((r) => Number(r.id)).sort((a, b) => a - b);
  const paramsOf = (href: string) =>
    Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? ''));

  /**
   * The live shape, scaled down: undecided drafts, decided ones, and the ones we
   * made while testing the tenant (four carry `_triggered_by` on a platform
   * domain, which is how the live sandbox's are attributed).
   */
  const undecided = [
    draft(1, { status: 'ready_for_review' }),
    draft(2, { status: 'ready_for_review' }),
    draft(3, { status: 'under_review' }),
    draft(4, { status: 'needs_revision' }),
  ];
  const decided = [
    draft(10, { status: 'approved' }),
    draft(11, { status: 'published' }),
    draft(12, { status: 'rejected' }),
    draft(13, { status: 'not_for_publication' }),
    draft(14, { status: 'for_repurpose' }),
  ];
  const ours = [
    draft(20, { status: 'ready_for_review', _triggered_by: 'qa+ma@startsimpli.com' }),
    draft(21, { status: 'ready_for_review' }, 'sub-qa'),
  ];
  const corpus = [...undecided, ...decided, ...ours];

  it('counts the drafts nobody has decided, and says so in drafts', () => {
    const rows = draftQueue(draftType, corpus, []);
    expect(rows.map((r) => r.id)).toEqual(['drafts-awaiting-decision']);
    // 4 undecided + draft 21 (ours only by owner, which an empty roster cannot
    // resolve). Draft 20 names a platform address on the row itself and goes.
    expect(rows[0].count).toBe(5);
    expect(rows[0].label).toBe('Awaiting a review decision — 5 drafts');
    expect(queueTotal(rows)).toBe(5);
  });

  it('is NOT all clear when every topic is judged but drafts are waiting', () => {
    // The exact live state: all topics carry a verdict and are filed, so the
    // topic queue is empty — and the card used to render its all-clear.
    const filed = [topic(1, { status: 'written', team_verdict: 'good' })];
    expect(topicQueue(topicType, filed)).toEqual([]);
    expect(draftQueue(draftType, corpus, []).length).toBe(1);
  });

  it('excludes our test drafts, exactly as its destination does', () => {
    // With a roster, draft 21's owner resolves to a platform QA account too.
    const rows = draftQueue(draftType, corpus, ['sub-qa']);
    expect(rows[0].count).toBe(4);
  });

  it('lands on exactly the drafts it counted — by id, through its own href', () => {
    const [row] = draftQueue(draftType, corpus, []);
    const params = paramsOf(row.href ?? '');
    const landed = applyDraftQueue(corpus, params, draftType);
    expect(landed).toHaveLength(row.count);
    expect(ids(landed)).toEqual(ids([...undecided, ours[1]]));
  });

  it('clears the destination gates that would hide the rows, and KEEPS the one it shares', () => {
    const [row] = draftQueue(draftType, corpus, []);
    const params = paramsOf(row.href ?? '');
    expect(row.href).toContain('/t/draft');
    // The 7-day window and the approved-topic gate hid these; the card counted
    // them regardless, so the link has to turn both off or the destination is
    // empty under a number that says 5.
    expect(params.since).toBe('all');
    expect(params.topic).toBe('all');
    // The test-draft gate is NOT cleared: the count already applied it, and
    // clearing it would show rows the card did not count.
    expect(params.made).toBeUndefined();
  });

  it('renders the active queue as a chip that names the card it came from', () => {
    const [row] = draftQueue(draftType, corpus, []);
    const chips = draftQueueChips(paramsOf(row.href ?? ''));
    expect(chips).toEqual([
      { param: TOPIC_QUEUE_PARAM, value: 'all', label: 'Awaiting a review decision' },
    ]);
    expect(draftQueueChips({})).toEqual([]);
  });

  it('narrows nothing, and chips nothing, for a queue value it does not recognise', () => {
    expect(applyDraftQueue(corpus, { [TOPIC_QUEUE_PARAM]: 'nonsense' }, draftType)).toHaveLength(11);
    expect(draftQueueChips({ [TOPIC_QUEUE_PARAM]: 'nonsense' })).toEqual([]);
    expect(applyDraftQueue(corpus, {}, draftType)).toHaveLength(11);
  });

  it('refuses a TOPIC queue id on the drafts table, and the reverse', () => {
    // One `queue` param, two spines. A id from the wrong spine is not a queue
    // here, so it narrows nothing rather than emptying the table.
    expect(applyDraftQueue(corpus, { [TOPIC_QUEUE_PARAM]: 'unjudged' }, draftType)).toHaveLength(11);
    expect(draftQueueChips({ [TOPIC_QUEUE_PARAM]: 'unjudged' })).toEqual([]);
    expect(topicQueueChips({ [TOPIC_QUEUE_PARAM]: 'drafts-awaiting-decision' })).toEqual([]);
  });

  it('drops the row entirely when nothing is waiting, so All clear means all clear', () => {
    expect(draftQueue(draftType, decided, [])).toEqual([]);
    expect(draftQueue(draftType, [], [])).toEqual([]);
  });

  it('reads status membership off the schema — an undeclared state is not counted', () => {
    // A tenant that declares only the two review states cannot have a draft at
    // `needs_revision`, so a row carrying one is a value the schema does not
    // pose and the queue does not claim it.
    const narrow: EntityTypeDef = {
      ...draftType,
      attributes: [{ ...draftStatusAttr, config: { choices: ['ready_for_review', 'approved'] } }],
    };
    const rows = draftQueue(narrow, [
      draft(1, { status: 'ready_for_review' }),
      draft(2, { status: 'needs_revision' }),
    ], []);
    expect(rows[0].count).toBe(1);
  });

  it('omits the row (rather than reporting 0) when the type declares no status enum', () => {
    expect(draftQueue(null, corpus, [])).toEqual([]);
  });

  it('calls a blank status undecided only when it is asked to stand behind it', () => {
    // No live draft carries a blank status (169 of 169 carry one, 2026-10-05).
    // A row with nothing in the field has not said it is waiting, so it is not
    // counted — the module's standing rule about numbers it cannot defend.
    expect(awaitsDraftDecision(draft(1, {}), ['ready_for_review'])).toBe(false);
    expect(awaitsDraftDecision(draft(1, { status: 'ready_for_review' }), ['ready_for_review'])).toBe(true);
    // The list it is handed is the DECLARED UNDECIDED one, so a decided status
    // is simply not in it.
    expect(
      awaitsDraftDecision(draft(1, { status: 'approved' }), ['ready_for_review', 'under_review']),
    ).toBe(false);
  });
});

describe('ingestionSummary', () => {
  // Two deliveries 12h apart, ~3 records each — the real shape: bursts, not a trickle.
  const burst = (headIso: string, n: number, id0: number) =>
    Array.from({ length: n }, (_, i) =>
      news(id0 + i, new Date(new Date(headIso).getTime() - i * 1000).toISOString(), { domain: 'zawya.com' }),
    );
  const threeDeliveries = [
    ...burst('2026-08-20T00:15:00.000Z', 3, 0),
    ...burst('2026-08-19T12:15:00.000Z', 3, 10),
    ...burst('2026-08-19T00:15:00.000Z', 3, 20),
  ];

  it('reports the all-time total from the API envelope, never the sample length', () => {
    const s = ingestionSummary([], threeDeliveries, 3648);
    expect(s.totalArticles).toBe(3648);
    expect(s.sampleSize).toBe(9);
  });

  it('leaves the total unknown (null) rather than substituting the sample length', () => {
    expect(ingestionSummary([], threeDeliveries, null).totalArticles).toBeNull();
  });

  it('takes last delivery from the newest article in the sample', () => {
    expect(ingestionSummary([], threeDeliveries, 3648).lastDeliveryAt).toBe('2026-08-20T00:15:00.000Z');
  });

  it('observes cadence from the gaps BETWEEN delivery bursts, not between articles', () => {
    const s = ingestionSummary([], threeDeliveries, 3648);
    expect(s.deliveriesObserved).toBe(3);
    expect(s.cadenceHours).toBe(12);
  });

  it('refuses to state a cadence from a single observed gap', () => {
    const s = ingestionSummary([], threeDeliveries.slice(0, 6), 3648);
    expect(s.deliveriesObserved).toBe(2);
    expect(s.cadenceHours).toBeNull();
  });

  it('refuses to state a cadence when the observed gaps are irregular', () => {
    const irregular = [
      ...burst('2026-08-20T00:00:00.000Z', 2, 0),
      ...burst('2026-08-19T12:00:00.000Z', 2, 10), // 12h
      ...burst('2026-08-19T11:00:00.000Z', 2, 20), // 1h
      ...burst('2026-08-18T00:00:00.000Z', 2, 30), // 35h
    ];
    expect(ingestionSummary([], irregular, 3648).cadenceHours).toBeNull();
  });

  it('reports source coverage as a SAMPLE fact — the window, never an all-time claim', () => {
    const sources = [
      source(1, 'Zawya', 'zawya.com'),
      source(2, 'Gulf News', 'gulfnews.com'),
      source(3, 'ADGM', 'adgm.com'),
    ];
    const s = ingestionSummary(sources, threeDeliveries, 3648);
    expect(s.sourcesDeclared).toBe(3);
    expect(s.sourcesInSample).toBe(1);
    expect(s.sampleSize).toBe(9);
  });

  it('counts a declared source once per domain and ignores domainless records', () => {
    const sources = [
      source(1, 'Zawya', 'zawya.com'),
      source(2, 'Zawya dup', 'ZAWYA.com'),
      source(3, 'No domain'),
    ];
    const s = ingestionSummary(sources, threeDeliveries, 3648);
    expect(s.sourcesDeclared).toBe(1);
    expect(s.sourcesInSample).toBe(1);
  });

  it('never invents a source row for a domain the tenant has not declared', () => {
    const s = ingestionSummary([source(1, 'ADGM', 'adgm.com')], threeDeliveries, 3648);
    expect(s.sourcesDeclared).toBe(1);
    expect(s.sourcesInSample).toBe(0);
  });

  it('reads the camelCased news blob for the domain join', () => {
    const items = [news(1, '2026-08-20T00:15:00.000Z', { domain: 'zawya.com' })];
    expect(ingestionSummary([source(1, 'Zawya', 'zawya.com')], items, 1).sourcesInSample).toBe(1);
  });

  it('is honestly empty when no articles have arrived', () => {
    const s = ingestionSummary([source(1, 'Zawya', 'zawya.com')], [], 0);
    expect(s.lastDeliveryAt).toBeNull();
    expect(s.cadenceHours).toBeNull();
    expect(s.deliveriesObserved).toBe(0);
    expect(s.sampleSize).toBe(0);
    expect(s.sourcesInSample).toBe(0);
  });

  it('ignores articles with an unparseable created_at instead of dating them to the epoch', () => {
    const s = ingestionSummary([], [news(1, 'not-a-date'), ...threeDeliveries], 3648);
    expect(s.lastDeliveryAt).toBe('2026-08-20T00:15:00.000Z');
    expect(s.deliveriesObserved).toBe(3);
  });
});

describe('ingestionOverdue', () => {
  const at = (iso: string) => new Date(iso).getTime();
  const base = {
    totalArticles: 3648, lastDeliveryAt: '2026-08-20T00:15:00.000Z',
    deliveriesObserved: 5, sampleSize: 200, sourcesDeclared: 55, sourcesInSample: 10,
  };

  it('is false while the wait is inside twice the observed cadence', () => {
    expect(ingestionOverdue({ ...base, cadenceHours: 12 }, at('2026-08-20T20:00:00.000Z'))).toBe(false);
  });

  it('is true once the wait passes twice the observed cadence', () => {
    expect(ingestionOverdue({ ...base, cadenceHours: 12 }, at('2026-08-21T02:00:00.000Z'))).toBe(true);
  });

  it('is false when no cadence was observed — there is no schedule to be late against', () => {
    expect(ingestionOverdue({ ...base, cadenceHours: null }, at('2026-09-01T00:00:00.000Z'))).toBe(false);
  });

  it('is false when nothing has ever been delivered', () => {
    expect(
      ingestionOverdue({ ...base, lastDeliveryAt: null, cadenceHours: 12 }, at('2026-09-01T00:00:00.000Z')),
    ).toBe(false);
  });
});

describe('removed widgets stay removed', () => {
  it('no longer exports a hardcoded needs-verdict status', async () => {
    const mod = await import('../health-data');
    expect('NEEDS_VERDICT_STATUS' in mod).toBe(false);
  });

  it('no longer exports the delivery or per-source freshness mappers', async () => {
    const mod = await import('../health-data');
    expect('deliveryFromTopics' in mod).toBe(false);
    expect('sourceFreshness' in mod).toBe(false);
    expect('attentionFromTopics' in mod).toBe(false);
  });
});
