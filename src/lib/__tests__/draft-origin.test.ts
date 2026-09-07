/**
 * "Who made this?" (bd startsim-4gw21).
 *
 * The fixtures are the SHAPES MEASURED on the live marketing-agents tenant
 * 2026-09-07, because the whole value of this column is that it reports the data
 * rather than a story about it:
 *   - 153 of 153 drafts carry `data._origin === 'n8n-weekly-writer'`
 *   - 150 of them are owned by `svc:n8n-ogmc`
 *   - the other 3 are ar/zh translations owned by a PERSON's user id while still
 *     carrying the writer's `_origin` — the case that decides the label order
 *   - 5 carry `human_edited` marks on notes/review/blog/source_meta
 */
import { describe, it, expect } from 'vitest';

import {
  describeRecordOrigin,
  isServiceOwner,
  originTooltip,
  ORIGIN_ATTR,
  SERVICE_OWNER_PREFIX,
} from '../draft-origin';
import { originColumn, ORIGIN_COLUMN_ID } from '@/components/origin-column';
import type { EntityRecord } from '@/lib/foundry-api';

const WRITER = 'n8n-weekly-writer';
const SERVICE = 'svc:n8n-ogmc';
/** A real person's central-auth id (qa-marketing-agents@startsimpli.com). */
const PERSON = '1c44a170-eee3-4922-b38b-36dbe76e7ee5';

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

  it('never claims to know WHICH trigger started the run', () => {
    // Both the 6-hourly poller and the "Generate drafts" button call the same
    // sub-workflow and neither stamps itself, so the copy has to say so.
    const origin = describeRecordOrigin(record({ data: { Origin: WRITER } }));
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
    const accessor = originColumn().accessorFn!;
    const machine = record({ data: { Origin: WRITER }, ownerSub: SERVICE });
    const touched = record({ data: { Origin: WRITER }, ownerSub: SERVICE, humanEdited: { data: { blog: {} } } });
    const human = record({ data: {}, ownerSub: PERSON });
    expect(accessor(machine)).toBe('ai writer');
    expect(accessor(touched)).toBe('ai writer edited');
    expect(accessor(human)).toBe('person');
  });
});
