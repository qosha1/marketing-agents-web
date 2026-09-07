/**
 * `?status=` on a board: the header, the chips and the lanes must agree
 * (bd startsim-flv2x.7).
 *
 * THE DEFECT. Three places disagreed about who owns the lane-defining attribute:
 *
 *   lib/board.ts   pickAttrFilters picks ANY declared enum, and `status` is one.
 *   lib/lanes.ts   laneFilters applies the LANE's own value LAST, so every lane
 *                  overwrites an incoming `?status=` and ignores it — deliberately
 *                  (lanes.ts: "a board pre-filtered to ?status=surfaced still
 *                  lays out every lane").
 *   the board page  counts with it (countEntities over baseFilters) and chips it.
 *
 * So the lanes ignored the param while the count and the chip did not, and the
 * header could report a total SMALLER than the number of records on screen.
 * Measured live on marketing-agents 2026-09-06, and reproduced below record for
 * record:
 *
 *   /board/topic?status=ready
 *     header "82 of 2 records"   chip "status: ready"
 *     lanes  Suggested 43 | Ready 2 | Rejected 16 | Written 21  — ALL of them
 *
 *   /board/topic?content_type=weekly_brief&status=ready
 *     header "41 of 1 records"   chips "content type: weekly_brief", "status: ready"
 *     lanes  14 | 1 | 13 | 13
 *
 * THE FIX IS TO REFUSE THE PARAM, NOT TO HONOUR IT. Narrowing the board to the
 * one named lane would make the chip true, but a one-lane kanban is a worse
 * table with none of the table's columns — rejected on startsim-flv2x.2. So the
 * board applies every declared enum EXCEPT the one whose choices ARE its lanes,
 * which is what the lanes have always done. Telling the reader that a facet was
 * refused is startsim-flv2x.8, and `ignored` below is what it will render.
 *
 * NOT by the literal name "status": pickStatusAttr falls back to the first enum
 * with choices, so a `deal` type whose lanes are `stage` has exactly the same
 * collision. The deal cases below are what discriminate a real fix from one that
 * hardcodes the string.
 */
import { describe, it, expect } from 'vitest';
import {
  boardAttrFilters,
  boardColumns,
  facetFilters,
  pickStatusAttr,
} from '../board';
import { LANE_PAGE_SIZE, lanePageRequests } from '../lanes';
import type { AttributeDef, EntityFilters, EntityTypeDef } from '@/lib/foundry-api';

function enumAttr(id: string, name: string, choices: string[]): AttributeDef {
  return { id, name, dataType: 'enum', required: false, config: { choices } };
}
function textAttr(id: string, name: string): AttributeDef {
  return { id, name, dataType: 'text', required: false, config: {} };
}

/** The live topic schema, trimmed to the attributes this file exercises. */
const TOPIC: EntityTypeDef = {
  id: 't', key: 'topic', label: 'Topic',
  attributes: [
    textAttr('1', 'market'),
    enumAttr('2', 'status', ['suggested', 'ready', 'rejected', 'written']),
    enumAttr('3', 'content_type', ['weekly_brief', 'lead_magnet', 'general']),
  ],
};

/**
 * A type whose lanes are NOT called "status" — pickStatusAttr falls back to the
 * first enum with choices, so `stage` is the lane axis here and `region` is an
 * ordinary facet. Any fix that special-cases the name "status" passes every
 * TOPIC case above and breaks this one.
 */
const DEAL: EntityTypeDef = {
  id: 'd', key: 'deal', label: 'Deal',
  attributes: [
    enumAttr('1', 'stage', ['open', 'won', 'lost']),
    enumAttr('2', 'region', ['emea', 'amer']),
  ],
};

/** No enum with choices at all, so pickStatusAttr is null and there are no lanes. */
const SETTING: EntityTypeDef = {
  id: 's', key: 'setting', label: 'Setting',
  attributes: [textAttr('1', 'value')],
};

/**
 * The live topic board, record for record.
 *
 * The two MEASURED slices are exact: all four lanes sum to 82, and the
 * weekly_brief four sum to 41 as 14/1/13/13. How the remaining 41 divide between
 * `lead_magnet` and `general` was not measured, so they are all filed under
 * `general` — nothing here depends on that split.
 */
const LIVE_LANES: Array<[string, string, number]> = [
  ['weekly_brief', 'suggested', 14],
  ['weekly_brief', 'ready', 1],
  ['weekly_brief', 'rejected', 13],
  ['weekly_brief', 'written', 13],
  ['general', 'suggested', 29],
  ['general', 'ready', 1],
  ['general', 'rejected', 3],
  ['general', 'written', 8],
];
const RECORDS: Array<Record<string, string>> = LIVE_LANES.flatMap(
  ([content_type, status, n]) => Array.from({ length: n }, () => ({ content_type, status })),
);

/** Stand-in for the tenant backend: how many records match these `attr.*` filters. */
function count(filters: EntityFilters): number {
  return RECORDS.filter((r) =>
    Object.entries(filters).every(([k, v]) => r[k.replace(/^attr\./, '')] === v),
  ).length;
}

/**
 * Exactly what board/[typeKey]/page.tsx computes for a URL, in its own order:
 * the facets, the baseFilters both the count and the lanes are built from, and
 * the lane queries themselves.
 */
function boardFor(type: EntityTypeDef, params: Record<string, string>) {
  const facets = boardAttrFilters(type, params);
  const base: EntityFilters = { ...(facetFilters(facets.applied, null) ?? {}) };
  const statusAttr = pickStatusAttr(type);
  const requests = lanePageRequests(boardColumns(statusAttr), statusAttr?.name ?? '', {}, base);
  return { facets, base, requests, chips: facets.applied.map((f) => f.name) };
}

describe('boardAttrFilters — one list behind both the chips and the count', () => {
  it('does not apply the attribute whose choices are the lanes', () => {
    const { applied } = boardAttrFilters(TOPIC, { content_type: 'weekly_brief', status: 'ready' });
    expect(applied).toEqual([{ name: 'content_type', value: 'weekly_brief' }]);
  });

  it('reports that lane value as refused rather than as absent', () => {
    // startsim-flv2x.8 renders this. Dropping the param silently and never
    // recording that it arrived is how the reader is left guessing.
    const { ignored } = boardAttrFilters(TOPIC, { content_type: 'weekly_brief', status: 'ready' });
    expect(ignored).toEqual([{ name: 'status', value: 'ready' }]);
  });

  it('finds the lane attribute by schema, not by the name "status"', () => {
    // DEAL's lanes are `stage`. `region` is an ordinary facet and must survive.
    const { applied, ignored } = boardAttrFilters(DEAL, { stage: 'won', region: 'emea' });
    expect({ applied, ignored }).toEqual({
      applied: [{ name: 'region', value: 'emea' }],
      ignored: [{ name: 'stage', value: 'won' }],
    });
  });

  it('refuses nothing when the URL names no lane value', () => {
    expect(boardAttrFilters(TOPIC, { content_type: 'general' })).toEqual({
      applied: [{ name: 'content_type', value: 'general' }],
      ignored: [],
    });
  });

  it('ignores a lane value that is not a declared choice, and does not chip it', () => {
    // Not a facet at all — it never produced a chip and must not start now.
    expect(boardAttrFilters(TOPIC, { status: 'bogus' })).toEqual({ applied: [], ignored: [] });
  });

  it('survives a type with no lane attribute at all', () => {
    expect(boardAttrFilters(SETTING, { value: 'anything' })).toEqual({ applied: [], ignored: [] });
  });
});

describe('the header, the chips and the lanes agree on one URL', () => {
  it('has every lane inside a single page, so lane totals ARE what is loaded', () => {
    // Guards the fixture, not the code: the assertions below speak about the
    // header's first number ("how many are loaded"), which only equals the lane
    // totals while no lane has a second page.
    const biggest = Math.max(...LIVE_LANES.map(([, , n]) => n));
    expect(biggest).toBeLessThanOrEqual(LANE_PAGE_SIZE);
  });

  it('/board/topic?status=ready reports the 82 its lanes are showing, not 2', () => {
    const { base, requests } = boardFor(TOPIC, { status: 'ready' });
    const matching = count(base); // the header's SECOND number
    const loaded = requests.reduce((n, req) => n + count(req.filters), 0); // its FIRST
    expect({ loaded, matching }).toEqual({ loaded: 82, matching: 82 });
  });

  it('/board/topic?content_type=weekly_brief&status=ready reports 41, not 1', () => {
    const { base, requests, chips } = boardFor(TOPIC, {
      content_type: 'weekly_brief',
      status: 'ready',
    });
    const matching = count(base);
    const loaded = requests.reduce((n, req) => n + count(req.filters), 0);
    expect({ loaded, matching, chips }).toEqual({
      loaded: 41,
      matching: 41,
      chips: ['content_type'],
    });
  });

  it('counts over filters that every lane query actually carries', () => {
    // The structural form of the same invariant: countEntities(base) is only the
    // size of the slice the lanes show if EVERY key in base reaches EVERY lane
    // query unchanged. A key a lane overwrites is a key the count must not hold.
    const { base, requests } = boardFor(TOPIC, { content_type: 'weekly_brief', status: 'ready' });
    const disagreements = requests.flatMap((req) =>
      Object.entries(base)
        .filter(([k, v]) => req.filters[k] !== v)
        .map(([k, v]) => `lane ${req.laneId}: counted ${k}=${v}, queried ${k}=${String(req.filters[k])}`),
    );
    expect(disagreements).toEqual([]);
  });

  it('holds for a board whose lanes are not called status', () => {
    const { base, requests, chips } = boardFor(DEAL, { stage: 'won', region: 'emea' });
    expect(chips).toEqual(['region']);
    expect(Object.keys(base)).toEqual(['attr.region']);
    expect(requests.every((req) => req.filters['attr.region'] === 'emea')).toBe(true);
  });
});
