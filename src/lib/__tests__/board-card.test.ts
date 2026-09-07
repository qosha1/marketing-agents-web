/**
 * A board card must not repeat what the reader can already see (bd startsim-8hgmq.5).
 *
 * Quinn, 2026-09-07, looking at /board/topic filtered to Evergreen: "in board
 * view, the columns ARE the status so why do we still show the status in the
 * card data. thats stupid". Measured on the live tenant the same day, the first
 * card in Suggested read:
 *
 *     Abu Dhabi Off-Plan Mortgage Guide for Foreign Buyers   <- the heading
 *     Title: Abu Dhabi Off-Plan Mortgage Gui…                <- the SAME string
 *     Market: Abu Dhabi (UAE)
 *     Content Type: lead_magnet                              <- the tab says
 *                                                               Evergreen and the
 *                                                               header carries a
 *                                                               lead_magnet chip
 *     [ suggested ▾ ]                                        <- inside the
 *                                                               Suggested lane
 *
 * Three redundancies, three different rules, all of them GENERIC — no attribute
 * name is special-cased, because the next tenant's board will not be `topic`:
 *
 *   (a) a value that IS the heading earns no meta row, on any type;
 *   (b) the lane is not repeated on the card, and the card carries NO status
 *       control at all (bd startsim-8hgmq.12) — dragging is how a card moves;
 *   (c) an attribute the active facet has already pinned to one value is
 *       suppressed, derived from that filter and never from a hardcoded name.
 *
 * The lane MOVE itself is untouched by all of this: it still writes status and
 * only status (lib/__tests__/board-review.test.ts pins that, and `laneMoveData`
 * is not called from here).
 */
import { describe, expect, it } from 'vitest';

import { cardBody, cardHeading } from '@/lib/board-card';
import type { AttrFilter } from '@/lib/board';
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/**
 * The topic spine, shaped so it reproduces the card measured above: the first
 * three attributes that are not the lane / a blob / the assignee are title,
 * market and content_type, which is exactly the three lines the live card shows.
 * `team_notes` and `source_1` sit behind them — they are what a cap-then-
 * backfill would promote into the freed slots.
 *
 * `subtitle` is deliberately a longtext sitting AFTER the capped three: the card
 * promotes it by NAME, so where it is declared and what it is declared as cannot
 * matter (the table folds it out of its own columns for the same reason).
 */
const TOPIC: EntityTypeDef = {
  id: 't1',
  key: 'topic',
  label: 'Topic',
  attributes: [
    { id: 'a1', name: 'title', dataType: 'text', required: false, config: {} },
    { id: 'a2', name: 'market', dataType: 'text', required: false, config: {} },
    {
      id: 'a3',
      name: 'content_type',
      dataType: 'enum',
      required: false,
      config: { choices: ['weekly_brief', 'lead_magnet', 'general'] },
    },
    {
      id: 'a4',
      name: 'status',
      dataType: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'written', 'rejected'] },
    },
    { id: 'a5', name: 'assignee_name', dataType: 'text', required: false, config: {} },
    { id: 'a6', name: 'subtitle', dataType: 'longtext', required: false, config: {} },
    { id: 'a7', name: 'angle', dataType: 'text', required: false, config: {} },
    { id: 'a8', name: 'team_notes', dataType: 'longtext', required: false, config: {} },
    { id: 'a9', name: 'source_1', dataType: 'text', required: false, config: {} },
    { id: 'a10', name: 'auto_checks', dataType: 'json', required: false, config: {} },
  ],
};

const NAME = 'Abu Dhabi Off-Plan Mortgage Guide for Foreign Buyers';

function topic(data: Record<string, unknown>, over: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: 42,
    entityType: 'topic',
    externalId: null,
    name: NAME,
    data,
    createdAt: '2026-09-07T00:00:00Z',
    ...over,
  } as EntityRecord;
}

/** The live card's data, as measured. */
const LIVE = {
  title: NAME,
  subtitle:
    "A practical guide to Abu Dhabi's new off-plan mortgage framework — covering the 50% payment threshold.",
  market: 'Abu Dhabi (UAE)',
  contentType: 'lead_magnet',
  status: 'suggested',
};

const EVERGREEN: AttrFilter[] = [{ name: 'content_type', value: 'lead_magnet' }];

function labels(body: ReturnType<typeof cardBody>): string[] {
  return body.rows.map((r) => `${r.label}: ${r.value}`);
}

describe('the heading is the one the card actually renders', () => {
  it('is the name, then the external id, then the bare row id', () => {
    expect(cardHeading(topic({}))).toBe(NAME);
    expect(cardHeading(topic({}, { name: '', externalId: 'ogmc-77' }))).toBe('ogmc-77');
    expect(cardHeading(topic({}, { name: '', externalId: null }))).toBe('#42');
  });
});

describe('(a) an attribute that IS the heading earns no meta row', () => {
  it('drops the duplicated title', () => {
    const body = cardBody(TOPIC, topic(LIVE), { statusName: 'status' });
    expect(body.rows.map((r) => r.name)).not.toContain('title');
  });

  it('ignores case and runs of whitespace when deciding it is the same title', () => {
    const body = cardBody(TOPIC, topic({ ...LIVE, title: `  abu dhabi off-plan   mortgage guide for foreign buyers ` }), {
      statusName: 'status',
    });
    expect(body.rows.map((r) => r.name)).not.toContain('title');
  });

  it('KEEPS a title that has genuinely drifted from the heading — that is news, not noise', () => {
    const body = cardBody(TOPIC, topic({ ...LIVE, title: 'Abu Dhabi Off-Plan Mortgages (v2 rewrite)' }), {
      statusName: 'status',
    });
    expect(labels(body)).toContain('title: Abu Dhabi Off-Plan Mortgages (v2 rewrite)');
  });

  it('surfaces the subtitle under the heading instead — the line that says what the topic covers', () => {
    const body = cardBody(TOPIC, topic(LIVE), { statusName: 'status' });
    expect(body.subtitle).toBe(LIVE.subtitle);
    // and never twice: the promoted attribute does not also get a meta row
    expect(body.rows.map((r) => r.name)).not.toContain('subtitle');
  });

  it('falls back to the next declared subtitle attribute when the first is empty', () => {
    const body = cardBody(TOPIC, topic({ ...LIVE, subtitle: '   ', angle: 'What foreign buyers get wrong' }), {
      statusName: 'status',
    });
    expect(body.subtitle).toBe('What foreign buyers get wrong');
  });

  it('promotes nothing when the record has no subtitle at all', () => {
    const { subtitle } = cardBody(TOPIC, topic({ market: 'UAE', status: 'ready' }), { statusName: 'status' });
    expect(subtitle).toBeNull();
  });

  it('refuses a subtitle that is only the heading again', () => {
    const { subtitle } = cardBody(TOPIC, topic({ ...LIVE, subtitle: NAME }), { statusName: 'status' });
    expect(subtitle).toBeNull();
  });
});


describe('(c) an attribute the active facet has pinned to one value', () => {
  it('is suppressed while the board is scoped to it', () => {
    const body = cardBody(TOPIC, topic(LIVE), { statusName: 'status', pinned: EVERGREEN });
    expect(body.rows.map((r) => r.name)).not.toContain('content_type');
  });

  it('comes BACK on the unscoped board, where it is the only thing telling the kinds apart', () => {
    const body = cardBody(TOPIC, topic(LIVE), { statusName: 'status', pinned: [] });
    expect(labels(body)).toContain('content type: lead_magnet');
  });

  it('is derived from the filter, not from the name "content_type"', () => {
    const deal: EntityTypeDef = {
      id: 't2',
      key: 'deal',
      label: 'Deal',
      attributes: [
        { id: 'd1', name: 'region', dataType: 'enum', required: false, config: { choices: ['emea', 'amer'] } },
        { id: 'd2', name: 'owner', dataType: 'text', required: false, config: {} },
        { id: 'd3', name: 'stage', dataType: 'enum', required: false, config: { choices: ['won', 'lost'] } },
      ],
    };
    const record = {
      id: 7,
      entityType: 'deal',
      externalId: null,
      name: 'Acme renewal',
      data: { region: 'emea', owner: 'Jurga', stage: 'won' },
      createdAt: '2026-09-07T00:00:00Z',
    } as EntityRecord;
    const body = cardBody(deal, record, { statusName: 'stage', pinned: [{ name: 'region', value: 'emea' }] });
    expect(labels(body)).toEqual(['owner: Jurga']);
  });

  it('keeps the row when the record DISAGREES with the pinned value — then it is not redundant', () => {
    const body = cardBody(TOPIC, topic({ ...LIVE, contentType: 'general' }), {
      statusName: 'status',
      pinned: EVERGREEN,
    });
    expect(labels(body)).toContain('content type: general');
  });
});

describe('what a card body leaves out for its own sake', () => {
  it('never repeats the lane: the status attribute itself is not a meta row', () => {
    const body = cardBody(TOPIC, topic(LIVE), { statusName: 'status', pinned: EVERGREEN });
    expect(body.rows.map((r) => r.name)).not.toContain('status');
  });

  it('leaves the assignee to its own chip and blobs to the detail drawer', () => {
    const body = cardBody(
      TOPIC,
      topic({ assigneeName: 'Malin', teamNotes: 'x'.repeat(400), autoChecks: { ok: true }, market: 'UAE' }),
      { statusName: 'status' },
    );
    const names = body.rows.map((r) => r.name);
    expect(names).not.toContain('assignee_name');
    expect(names).not.toContain('team_notes');
    expect(names).not.toContain('auto_checks');
  });

  it('drops an attribute the record simply has no value for', () => {
    const body = cardBody(TOPIC, topic({ ...LIVE, market: '' }), { statusName: 'status' });
    expect(body.rows.map((r) => r.name)).not.toContain('market');
  });

  it('reads the camelCased key the data blob actually uses', () => {
    const body = cardBody(TOPIC, topic(LIVE), { statusName: 'status', pinned: [] });
    expect(labels(body)).toContain('content type: lead_magnet');
  });

  it('renders a boolean as Yes / No', () => {
    const flagged: EntityTypeDef = {
      ...TOPIC,
      attributes: [{ id: 'b1', name: 'good_example', dataType: 'boolean', required: false, config: {} }],
    };
    expect(labels(cardBody(flagged, topic({ goodExample: true }), { statusName: 'status' }))).toEqual([
      'good example: Yes',
    ]);
    expect(labels(cardBody(flagged, topic({ goodExample: false }), { statusName: 'status' }))).toEqual([
      'good example: No',
    ]);
  });
});

/**
 * THE CAP IS A CEILING, NOT A QUOTA — record-columns.ts learned this the
 * expensive way (see its `defaultVisibleColumns` note): filtering before the cap
 * BACKFILLS the freed slot with whatever attribute came next, so a change that
 * removes a redundant line makes the card LONGER and noisier. Removing a row has
 * to make the card shorter.
 */
describe('removing a redundant row makes the card SHORTER, never differently noisy', () => {
  it('does not backfill the freed slots with the next attributes along', () => {
    const body = cardBody(TOPIC, topic({ ...LIVE, source1: 'https://wam.ae/…' }), {
      statusName: 'status',
      pinned: EVERGREEN,
    });
    expect(labels(body)).toEqual(['market: Abu Dhabi (UAE)']);
  });

  it('shows at most three meta rows on a type with nothing redundant to drop', () => {
    const wide: EntityTypeDef = {
      ...TOPIC,
      attributes: [
        { id: 'w1', name: 'one', dataType: 'text', required: false, config: {} },
        { id: 'w2', name: 'two', dataType: 'text', required: false, config: {} },
        { id: 'w3', name: 'three', dataType: 'text', required: false, config: {} },
        { id: 'w4', name: 'four', dataType: 'text', required: false, config: {} },
      ],
    };
    const body = cardBody(wide, topic({ one: '1', two: '2', three: '3', four: '4' }), { statusName: 'status' });
    expect(labels(body)).toEqual(['one: 1', 'two: 2', 'three: 3']);
  });
});
