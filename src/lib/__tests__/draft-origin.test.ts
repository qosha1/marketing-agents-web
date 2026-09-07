/**
 * "Who made this?" (bd startsim-4gw21, widened by startsim-8hgmq.6).
 *
 * The fixtures are the SHAPES MEASURED on the live marketing-agents tenant
 * 2026-09-07, because the whole value of this column is that it reports the data
 * rather than a story about it:
 *   - 153 of 153 drafts carry `data._origin === 'n8n-weekly-writer'`
 *   - 150 of them are owned by `svc:n8n-ogmc`
 *   - the other 3 are ar/zh translations owned by a PERSON's user id while still
 *     carrying the writer's `_origin` — the case that decides the label order
 *   - 5 carry `human_edited` marks on notes/review/blog/source_meta
 *   - NONE of them carries `_trigger`: the stamp went live at 21:31Z and the
 *     poller's last tick was 19:00:39Z (n8n execution 12864), so every row in
 *     the tenant today is the unstamped case. The stamped cases below are
 *     therefore fixtured from the WRITER'S OWN CODE — 'Build Tenant Draft' sets
 *     `_trigger` always (falling back to the literal 'unknown'), `_run_id` when
 *     n8n gives it one, and `_triggered_by` only when non-empty.
 *
 * BOTH SPELLINGS ARE TESTED for the new keys as well as for `_origin`. The
 * shared client camelCases response keys, so `_triggered_by` arrives as
 * `TriggeredBy`; reading only the raw key is how this column shipped once
 * already saying "Unknown" on all 153 rows.
 */
import { describe, it, expect } from 'vitest';

import {
  describeRecordOrigin,
  isServiceOwner,
  originTooltip,
  ORIGIN_ATTR,
  SERVICE_OWNER_PREFIX,
  TRIGGER_ATTR,
  TRIGGERED_BY_ATTR,
} from '../draft-origin';
import { originColumn, ORIGIN_COLUMN_ID } from '@/components/origin-column';
import type { EntityRecord } from '@/lib/foundry-api';

const WRITER = 'n8n-weekly-writer';
const SERVICE = 'svc:n8n-ogmc';
/** A real person's central-auth id (qa-marketing-agents@startsimpli.com). */
const PERSON = '1c44a170-eee3-4922-b38b-36dbe76e7ee5';
/** What `_triggered_by` carries: the caller's email (bd startsim-8hgmq.7). */
const REVIEWER = 'qa-marketing-agents@startsimpli.com';

function record(over: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: 1,
    entityType: 'draft',
    externalId: 'some-headline',
    name: 'Some headline',
    data: {},
    createdAt: '2026-09-07T19:02:28Z',
    ...over,
  };
}

describe('describeRecordOrigin', () => {
  it('labels a writer-stamped draft as machine-written, reading the CAMELCASED wire key', () => {
    // The shared @startsimpli/api client camelCases response keys including the
    // data blob, so `_origin` arrives as `Origin`. Reading only the raw key was
    // the way to ship a column that says "Unknown" on all 153 rows.
    const origin = describeRecordOrigin(record({ data: { Origin: WRITER }, ownerSub: SERVICE }));
    expect(origin.kind).toBe('automation');
    expect(origin.label).toBe('AI writer');
    expect(origin.detail).toContain(WRITER);
  });

  it('reads the raw snake_case key too, for any path that skips the transform', () => {
    const origin = describeRecordOrigin(record({ data: { [ORIGIN_ATTR]: WRITER } }));
    expect(origin.label).toBe('AI writer');
  });

  it('still says AI writer when the row is owned by a PERSON', () => {
    // The translations: a person asked for one, the machine wrote it, and the row
    // landed under their token. Labelling that "Person" would re-create exactly
    // the confusion this column exists to end.
    const origin = describeRecordOrigin(record({ data: { Origin: WRITER }, ownerSub: PERSON }));
    expect(origin.kind).toBe('automation');
    expect(origin.label).toBe('AI writer');
  });

  it('never claims to know which trigger started an UNSTAMPED run', () => {
    // The 153 rows written before 2026-09-07T21:31Z carry no `_trigger` at all
    // and can never be back-attributed. They keep the older, weaker sentence,
    // which is still exactly true of them — never a guess, and never 'unknown'
    // dressed up as a finding.
    const origin = describeRecordOrigin(record({ data: { Origin: WRITER } }));
    expect(origin.label).toBe('AI writer');
    expect(origin.trigger).toBe('unknown');
    expect(origin.detail).toMatch(/does not say which/i);
  });

  it('falls back to the service owner when nothing stamped an origin', () => {
    const origin = describeRecordOrigin(record({ data: {}, ownerSub: SERVICE }));
    expect(origin.kind).toBe('automation');
    expect(origin.label).toBe('Automation');
    expect(origin.detail).toContain(SERVICE);
  });

  it('calls an unstamped, person-owned row a person', () => {
    const origin = describeRecordOrigin(record({ data: {}, ownerSub: PERSON }));
    expect(origin.kind).toBe('person');
    expect(origin.label).toBe('Person');
  });

  it.each([undefined, null, ''])('reports %p owner with no origin as Unknown, not as a person', (owner) => {
    const origin = describeRecordOrigin(record({ data: {}, ownerSub: owner }));
    expect(origin.kind).toBe('unknown');
    expect(origin.label).toBe('Unknown');
    // An unstamped row predates the marker. Saying "Person" there would invent a
    // human out of an absence — the one thing this column must never do.
    expect(origin.detail).not.toMatch(/\bperson\b/i);
  });

  it('ignores a blank origin string rather than labelling it machine-written', () => {
    expect(describeRecordOrigin(record({ data: { Origin: '   ' }, ownerSub: PERSON })).kind).toBe('person');
  });
});

describe('edited-since marks', () => {
  const edited = {
    data: {
      review: { at: '2026-08-31T10:52:48Z', sub: 'f496dea4' },
      blog: { at: '2026-08-31T10:48:11Z', sub: 'f496dea4' },
      notes: { at: '2026-08-31T10:34:51Z', sub: 'f496dea4' },
    },
  };

  it('lists the edited fields, sorted, without changing the origin', () => {
    const origin = describeRecordOrigin(
      record({ data: { Origin: WRITER }, ownerSub: SERVICE, humanEdited: edited }),
    );
    expect(origin.label).toBe('AI writer');
    expect(origin.editedFields).toEqual(['blog', 'notes', 'review']);
  });

  it('says "edited through the app", never "edited by a person"', () => {
    // The mark records that a value was set through the GET-then-write endpoints
    // — an endpoint distinction, not a claim about who typed it.
    const tip = originTooltip(
      describeRecordOrigin(record({ data: { Origin: WRITER }, humanEdited: edited })),
    );
    expect(tip).toContain('Edited through the app since: blog, notes, review.');
  });

  it('leaves the tooltip untouched when nothing has been edited', () => {
    const origin = describeRecordOrigin(record({ data: { Origin: WRITER }, humanEdited: {} }));
    expect(origin.editedFields).toEqual([]);
    expect(originTooltip(origin)).toBe(origin.detail);
  });

  it.each([null, undefined, { data: null }, { data: [] }, 'nope' as unknown])(
    'treats the malformed marks %p as no edits rather than throwing',
    (marks) => {
      const origin = describeRecordOrigin(
        record({ data: { Origin: WRITER }, humanEdited: marks as EntityRecord['humanEdited'] }),
      );
      expect(origin.editedFields).toEqual([]);
    },
  );
});

describe('isServiceOwner', () => {
  it('recognises the service prefix and nothing else', () => {
    expect(isServiceOwner(`${SERVICE_OWNER_PREFIX}anything`)).toBe(true);
    expect(isServiceOwner(PERSON)).toBe(false);
    expect(isServiceOwner(null)).toBe(false);
    expect(isServiceOwner(42)).toBe(false);
  });
});

describe('originColumn', () => {
  it('is keyed so it can never collide with a declared attribute', () => {
    // Generated columns are keyed by attribute NAME; the double underscore is
    // what keeps this one out of that namespace (same convention as __actions).
    expect(ORIGIN_COLUMN_ID.startsWith('__')).toBe(true);
    expect(originColumn().id).toBe(ORIGIN_COLUMN_ID);
  });

  it('is headed with the question a reviewer actually asks', () => {
    expect(originColumn().header).toBe('Created by');
  });

  it('sorts the machine-written rows together, edited ones apart', () => {
    // KIND FIRST. With three automation labels ('AI writer', 'Generated',
    // 'Scheduled') a label-only sort would scatter the machine-written rows
    // across the alphabet and drop 'Person' in the middle of them, losing the
    // grouping this sort exists for.
    const accessor = originColumn().accessorFn!;
    const machine = record({ data: { Origin: WRITER }, ownerSub: SERVICE });
    const touched = record({ data: { Origin: WRITER }, ownerSub: SERVICE, humanEdited: { data: { blog: {} } } });
    const scheduled = record({ data: { Origin: WRITER, Trigger: 'schedule' }, ownerSub: SERVICE });
    const pressed = record({ data: { Origin: WRITER, Trigger: 'generate_button' }, ownerSub: SERVICE });
    const human = record({ data: {}, ownerSub: PERSON });
    expect(accessor(machine)).toBe('automation ai writer');
    expect(accessor(touched)).toBe('automation ai writer edited');
    expect(accessor(human)).toBe('person person');
    const keys = [machine, scheduled, pressed, human].map((r) => String(accessor(r))).sort();
    expect(keys.slice(0, 3).every((k) => k.startsWith('automation'))).toBe(true);
    expect(keys[3]).toBe('person person');
  });
});

/**
 * WHICH automation made it (bd startsim-8hgmq.6). The distinction the reviewer
 * asked for and the data could not answer until 2026-09-07T21:31Z.
 */
describe('which caller started the writer', () => {
  it('says a scheduled run was scheduled, and that nobody asked for it', () => {
    const origin = describeRecordOrigin(
      record({ data: { Origin: WRITER, Trigger: 'schedule' }, ownerSub: SERVICE }),
    );
    expect(origin.kind).toBe('automation');
    expect(origin.trigger).toBe('schedule');
    expect(origin.label).toBe('Scheduled');
    expect(origin.detail).toMatch(/6-hourly schedule/i);
    // The stale sentence the widening exists to retire: on a row that DOES say
    // which caller started it, claiming otherwise under-reports the data.
    expect(origin.detail).not.toMatch(/does not say which/i);
    expect(origin.triggeredBy).toBeUndefined();
  });

  it('names the person who pressed the button', () => {
    const origin = describeRecordOrigin(
      record({
        data: { Origin: WRITER, Trigger: 'generate_button', TriggeredBy: REVIEWER },
        ownerSub: SERVICE,
      }),
    );
    expect(origin.trigger).toBe('generate_button');
    expect(origin.label).toBe('Generated');
    expect(origin.triggeredBy).toBe(REVIEWER);
    expect(origin.detail).toContain(REVIEWER);
    expect(origin.detail).not.toMatch(/does not say which/i);
  });

  it('reads the RAW snake_case keys too, for any path that skips the transform', () => {
    const origin = describeRecordOrigin(
      record({ data: { [ORIGIN_ATTR]: WRITER, [TRIGGER_ATTR]: 'generate_button', [TRIGGERED_BY_ATTR]: REVIEWER } }),
    );
    expect(origin.label).toBe('Generated');
    expect(origin.triggeredBy).toBe(REVIEWER);
  });

  it('says somebody pressed it without inventing who, when the caller did not say', () => {
    // The writer OMITS `_triggered_by` when empty precisely so absence reads as
    // "not known" rather than as a person with a blank name.
    const origin = describeRecordOrigin(
      record({ data: { Origin: WRITER, Trigger: 'generate_button' }, ownerSub: SERVICE }),
    );
    expect(origin.label).toBe('Generated');
    expect(origin.triggeredBy).toBeUndefined();
    expect(origin.detail).toMatch(/somebody pressed/i);
    expect(origin.detail).toMatch(/does not say who/i);
  });

  it.each(['', '   '])('treats a blank triggered_by (%p) as nobody named', (who) => {
    const origin = describeRecordOrigin(
      record({ data: { Origin: WRITER, Trigger: 'generate_button', TriggeredBy: who } }),
    );
    expect(origin.triggeredBy).toBeUndefined();
    expect(origin.detail).toMatch(/does not say who/i);
  });

  it("keeps today's wording for a run whose caller told us nothing", () => {
    // 'unknown' is what the writer stamps when NOBODY TOLD IT — a hand-run from
    // the n8n editor, say. It is not "we tried and failed", and it is not
    // evidence of either caller, so it renders exactly as an unstamped row does.
    const stamped = describeRecordOrigin(record({ data: { Origin: WRITER, Trigger: 'unknown' } }));
    const unstamped = describeRecordOrigin(record({ data: { Origin: WRITER } }));
    expect(stamped.label).toBe('AI writer');
    expect(stamped.detail).toBe(unstamped.detail);
  });

  it('quotes a caller it does not recognise rather than hiding it', () => {
    // "No marker" and "a marker we don't understand" are different states, and
    // only one of them is somebody's bug.
    const origin = describeRecordOrigin(record({ data: { Origin: WRITER, Trigger: 'pipe_v3' } }));
    expect(origin.trigger).toBe('unknown');
    expect(origin.label).toBe('AI writer');
    expect(origin.detail).toContain('pipe_v3');
    expect(origin.detail).toMatch(/does not recognise/i);
  });

  it('carries the writer run id into the tooltip, so one run’s drafts group', () => {
    // Three presses = three writer runs = three ids. This is what turns "why are
    // there six near-identical drafts" into "two runs" without opening n8n.
    const origin = describeRecordOrigin(
      record({ data: { Origin: WRITER, Trigger: 'generate_button', TriggeredBy: REVIEWER, RunId: '12853' } }),
    );
    expect(origin.runId).toBe('12853');
    expect(originTooltip(origin)).toContain('Writer run 12853');
  });

  it('leaves an unstamped row with no run id and no person', () => {
    const origin = describeRecordOrigin(record({ data: { Origin: WRITER }, ownerSub: SERVICE }));
    expect(origin.runId).toBeUndefined();
    expect(origin.triggeredBy).toBeUndefined();
    expect(originTooltip(origin)).toBe(origin.detail);
  });

  it('never reports a trigger for a row that was not machine-written', () => {
    expect(describeRecordOrigin(record({ data: {}, ownerSub: PERSON })).trigger).toBe('unknown');
    expect(describeRecordOrigin(record({ data: {}, ownerSub: SERVICE })).trigger).toBe('unknown');
  });
});
