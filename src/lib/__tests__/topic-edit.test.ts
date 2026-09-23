/**
 * EDITING A TOPIC'S TEXT MUST NOT MOVE ANY OTHER ATTRIBUTE (bd startsim-m7fdm.7).
 *
 * The tenant PATCH REPLACES `data`, so a save from the draft page's topic panel
 * is a whole-blob write — and three of this tenant's live defects this month
 * were whole-blob writes that looked fine on screen:
 *
 *   • a body that carried only the edited fields DELETED the rest;
 *   • `source_1` went back as `source1`, renaming a declared attribute
 *     (bd startsim-8hgmq.18) — 33 topics needed repairing;
 *   • and `scope_path`, which carries the row's scope, has NO server-side net on
 *     update: tenant-starter's `EntityViewSet.perform_update` never calls
 *     `_require_scope_stamped` (only `perform_create` and the upsert paths do),
 *     so a PATCH that drops it returns 200 and the row goes invisible to every
 *     non-exempt reader.
 *
 * Every one of those is a property of the BODY THAT REACHES THE WIRE and not of
 * the form, so the assertions run there: stored (wire) -> snakeToCamel -> the
 * save path -> camelToSnake, with the REAL transforms imported from
 * @startsimpli/api. A test that stopped at the object handed to the client would
 * pass while the wire was still wrong, and could not see two keys collapsing
 * onto one wire key at all.
 *
 * THE FIXTURE IS A REAL ROW: topic 4daa885d-d831-43f7-9a0f-b4f03e40fab1 in the
 * `/ogmc-agent-test` sandbox, read from the live tenant 2026-09-23, and the
 * schema is the live `topic` type read the same day.
 */
import { describe, expect, it } from 'vitest';
import { snakeToCamel, camelToSnake } from '@startsimpli/api';
import { resolveReviewConfig } from '@startsimpli/ui/collection';

import type { EntityTypeDef } from '@/lib/foundry-api';
import { TOPIC_REVIEW_CONFIG } from '@/lib/review-vocabulary';
import {
  EMPTY_TITLE_ERROR,
  NOTE_FIELD_LABEL,
  topicEditData,
  topicEditError,
  topicEditChanges,
  topicEditFields,
  topicEditValues,
} from '@/lib/topic-edit';

/** The live marketing-agents `topic` type (GET /api/v1/schema/types/, 2026-09-23). */
const TOPIC_TYPE = {
  id: 'b0615cb3',
  key: 'topic',
  label: 'Topic',
  attributes: (
    [
      ['title', 'text'],
      ['angle', 'longtext'],
      ['market', 'text'],
      ['content_type', 'enum'],
      ['status', 'enum'],
      ['ai_rank', 'number'],
      ['team_verdict', 'text'],
      ['team_notes', 'longtext'],
      ['source_1', 'text'],
      ['source_2', 'text'],
      ['source_3', 'text'],
      ['delivered_at', 'date'],
      ['scheduled_for', 'date'],
      ['subtitle', 'text'],
      ['assignee_sub', 'text'],
      ['assignee_name', 'text'],
      ['scope_path', 'text'],
    ] as const
  ).map(([name, dataType], i) => ({
    id: String(i),
    name,
    dataType,
    required: false,
    config: {},
  })),
} as unknown as EntityTypeDef;

/** The blob as the tenant stores it — sandbox topic 4daa885d, 2026-09-23. */
const STORED: Record<string, unknown> = {
  title: "Qatar's $137 e-commerce licence and what it changes for foreign sellers",
  subtitle: 'One-draft writer proof for bd startsim-yvi57 — sandbox only, invisible to OGMC.',
  angle: 'Qatar has launched a $137 e-commerce licence covering 194 business activities.',
  market: 'Qatar',
  content_type: 'weekly_brief',
  status: 'written',
  team_verdict: 'good',
  team_notes: 'Agent sandbox: reset to suggested to exercise the approve -> story flow.',
  source_1: 'https://www.arabianbusiness.com/business/qatar-e-commerce-licence-business',
  scope_path: '/ogmc-agent-test',
};

const CFG = resolveReviewConfig(TOPIC_TYPE, TOPIC_REVIEW_CONFIG);
const FIELDS = topicEditFields(CFG, TOPIC_TYPE);
const DECLARED = TOPIC_TYPE.attributes.map((a) => a.name);

/** What the shared client hands a component. */
const asRead = (o: Record<string, unknown>) => snakeToCamel(o) as Record<string, unknown>;
/** What actually reaches the tenant. */
const onWire = (o: Record<string, unknown>) => camelToSnake(o) as Record<string, unknown>;

/**
 * One save, end to end: seed the form from the stored row, type `changes` into
 * it, then write the DIFF onto the blob the save re-read (`fresh`, defaulting to
 * the same row — the uncontended case).
 */
function saveWith(
  stored: Record<string, unknown>,
  changes: Record<string, string>,
  by: string | null = 'jurga@ogmc.example',
  fresh: Record<string, unknown> = stored,
) {
  const baseline = topicEditValues(asRead(stored), FIELDS);
  const values = { ...baseline, ...changes };
  const changed = topicEditChanges(FIELDS, values, baseline);
  const { data, history } = topicEditData(asRead(fresh), DECLARED, changed, values, by);
  return { wire: onWire(data), history };
}

describe('which fields the panel offers', () => {
  it('offers the topic TEXT — title, subtitle, angle and the reviewer note', () => {
    expect(FIELDS.map((f) => f.attr)).toEqual(['title', 'subtitle', 'angle', 'team_notes']);
  });

  it('leaves status and the kind/market chips alone — they are decided elsewhere', () => {
    const offered = new Set(FIELDS.map((f) => f.attr));
    for (const attr of ['status', 'team_verdict', 'content_type', 'market', 'ai_rank']) {
      expect(offered.has(attr)).toBe(false);
    }
  });

  it('takes the control from the attribute’s own dataType, never from its name', () => {
    expect(FIELDS.find((f) => f.attr === 'title')!.multiline).toBe(false);
    expect(FIELDS.find((f) => f.attr === 'angle')!.multiline).toBe(true);
    expect(FIELDS.find((f) => f.attr === 'team_notes')!.multiline).toBe(true);
  });

  it('calls the note what the read panel calls it, so the two cannot disagree', () => {
    expect(FIELDS.find((f) => f.attr === 'team_notes')!.label).toBe(NOTE_FIELD_LABEL);
  });

  it('offers nothing the type does not declare — a fork with no subtitle gets no subtitle box', () => {
    const lean = {
      ...TOPIC_TYPE,
      attributes: TOPIC_TYPE.attributes.filter((a) => a.name !== 'subtitle'),
    } as EntityTypeDef;
    expect(topicEditFields(resolveReviewConfig(lean, TOPIC_REVIEW_CONFIG), lean).map((f) => f.attr))
      .toEqual(['title', 'angle', 'team_notes']);
  });

  it('offers nothing at all before the schema loads', () => {
    expect(topicEditFields(CFG, null)).toEqual([]);
  });

  it('never offers one attribute twice, however the config points at it', () => {
    const cfg = resolveReviewConfig(TOPIC_TYPE, { ...TOPIC_REVIEW_CONFIG, summaryAttr: 'subtitle' });
    expect(topicEditFields(cfg, TOPIC_TYPE).map((f) => f.attr)).toEqual([
      'title',
      'subtitle',
      'team_notes',
    ]);
  });
});

describe('a title edit reaches the wire and nothing else moves', () => {
  it('writes the new title under the declared name', () => {
    const { wire } = saveWith(STORED, { title: 'Qatar’s $137 licence, and who it locks out' });
    expect(wire.title).toBe('Qatar’s $137 licence, and who it locks out');
    expect(Object.keys(wire).filter((k) => k.toLowerCase() === 'title')).toEqual(['title']);
  });

  it('leaves scope_path exactly as it was — the row must not leave its scope', () => {
    const { wire } = saveWith(STORED, { title: 'A new title' });
    expect(wire.scope_path).toBe('/ogmc-agent-test');
    expect(Object.keys(wire).filter((k) => k.toLowerCase().includes('scope'))).toEqual([
      'scope_path',
    ]);
  });

  it('carries every other attribute through untouched, none of them dropped', () => {
    const { wire } = saveWith(STORED, { title: 'A new title' });
    for (const [key, value] of Object.entries(STORED)) {
      if (key === 'title') continue;
      expect(wire[key]).toEqual(value);
    }
  });

  it('keeps source_1 spelled source_1 rather than re-minting source1', () => {
    const { wire } = saveWith(STORED, { title: 'A new title' });
    expect(wire.source_1).toBe(STORED.source_1);
    expect(wire).not.toHaveProperty('source1');
  });

  it('repairs a row already carrying the camel spelling on its way past', () => {
    const corrupted = { ...STORED, source1: STORED.source_1, source_1: undefined };
    delete corrupted.source_1;
    const { wire } = saveWith(corrupted, { title: 'A new title' });
    expect(wire.source_1).toBe(STORED.source_1);
    expect(wire).not.toHaveProperty('source1');
  });

  it('never sends two spellings of one attribute — they collide on the wire', () => {
    const { wire } = saveWith({ ...STORED, source1: 'camel' }, { title: 'A new title' });
    expect(Object.keys(wire).filter((k) => k.toLowerCase().startsWith('source'))).toEqual([
      'source_1',
    ]);
  });
});

describe('the other three fields', () => {
  it('saves an edited subtitle, angle and note together', () => {
    const { wire } = saveWith(STORED, {
      subtitle: 'What a $137 licence buys, and what it does not',
      angle: 'Foreign sellers now have a cheaper door in — with a catch.',
      team_notes: 'Tighten the lede; the licence fee is the hook.',
    });
    expect(wire.subtitle).toBe('What a $137 licence buys, and what it does not');
    expect(wire.angle).toBe('Foreign sellers now have a cheaper door in — with a catch.');
    expect(wire.team_notes).toBe('Tighten the lede; the licence fee is the hook.');
    expect(wire.title).toBe(STORED.title);
  });

  it('clearing a subtitle removes the attribute, the way the drawer already does', () => {
    const { wire } = saveWith(STORED, { subtitle: '   ' });
    expect(wire).not.toHaveProperty('subtitle');
    expect(wire).not.toHaveProperty('subtitle ');
    expect(wire.title).toBe(STORED.title);
  });

  it('trims what a reviewer typed rather than storing the whitespace', () => {
    const { wire } = saveWith(STORED, { title: '  A padded title  ' });
    expect(wire.title).toBe('A padded title');
  });
});

describe('an empty title is refused rather than deleting the attribute', () => {
  it('names the problem', () => {
    const values = { ...topicEditValues(asRead(STORED), FIELDS), title: '   ' };
    expect(topicEditError(FIELDS, values)).toBe(EMPTY_TITLE_ERROR);
  });

  it('accepts a form whose optional fields are all empty', () => {
    const values = { title: 'Still titled', subtitle: '', angle: '', team_notes: '' };
    expect(topicEditError(FIELDS, values)).toBeNull();
  });
});

describe('the edit log rides the blob it was read from (bd startsim-m7fdm.2)', () => {
  it('stamps the editor onto the log', () => {
    const { wire, history } = saveWith(STORED, { title: 'A new title' });
    expect(history.at(-1)).toMatchObject({ by: 'jurga@ogmc.example', saves: 1 });
    expect(wire._edit_history).toHaveLength(1);
  });

  it('KEEPS an entry that only the freshly re-read blob knows about', () => {
    // The save path re-reads the record and merges onto THAT. If the log were
    // read from the blob the page loaded instead, this entry — somebody else's
    // edit, landed while the form was open — would be silently erased, which is
    // startsim-m7fdm.2's own failure mode newly minted by the fix for it.
    const fresh = {
      ...STORED,
      _edit_history: [
        { by: 'malin@ogmc.example', from: '2026-09-23T09:00:00.000Z', at: '2026-09-23T09:04:00.000Z', saves: 3 },
      ],
    };
    const { wire } = saveWith(fresh, { title: 'A new title' });
    const log = wire._edit_history as { by?: string }[];
    expect(log).toHaveLength(2);
    expect(log[0].by).toBe('malin@ogmc.example');
    expect(log[1].by).toBe('jurga@ogmc.example');
  });

  it('records an unattributed edit rather than skipping it', () => {
    const { wire } = saveWith(STORED, { title: 'A new title' }, null);
    const log = wire._edit_history as { by?: string }[];
    expect(log).toHaveLength(1);
    expect(log[0].by).toBeUndefined();
  });

  it('writes the log under ONE key — not both spellings', () => {
    const read = asRead({ ...STORED, _edit_history: [] });
    const values = topicEditValues(read, FIELDS);
    const { data } = topicEditData(read, DECLARED, FIELDS, { ...values, title: 'x' }, 'a@b.c');
    expect(Object.keys(data).filter((k) => k.toLowerCase().includes('edithistory'))).toEqual([
      'EditHistory',
    ]);
  });
});

describe('a save writes the DIFF, not the whole form (bd startsim-m7fdm.2)', () => {
  const baseline = topicEditValues(asRead(STORED), FIELDS);

  it('reports nothing changed when the values still match what seeded them', () => {
    expect(topicEditChanges(FIELDS, baseline, baseline)).toEqual([]);
  });

  it('reports only the field that moved', () => {
    const values = { ...baseline, angle: 'different' };
    expect(topicEditChanges(FIELDS, values, baseline).map((f) => f.attr)).toEqual(['angle']);
  });

  it('does not call trailing whitespace a change', () => {
    const values = { ...baseline, title: `${STORED.title}  ` };
    expect(topicEditChanges(FIELDS, values, baseline)).toEqual([]);
  });

  it('LEAVES a form field somebody else moved while the form was open', () => {
    // She changed the title only. The angle she can see is the one the page
    // loaded; by the time she saves, Malin has rewritten it. Re-asserting the
    // stale angle would undo his edit without either of them noticing.
    const fresh = { ...STORED, angle: 'Malin rewrote the angle while she typed.' };
    const { wire } = saveWith(STORED, { title: 'A new title' }, 'jurga@ogmc.example', fresh);
    expect(wire.angle).toBe('Malin rewrote the angle while she typed.');
    expect(wire.title).toBe('A new title');
  });

  it('still overwrites a field she DID change \u2014 last write wins, and that is the open bead', () => {
    const fresh = { ...STORED, title: 'Malin\u2019s title' };
    const { wire } = saveWith(STORED, { title: 'Her title' }, 'jurga@ogmc.example', fresh);
    expect(wire.title).toBe('Her title');
  });
});
