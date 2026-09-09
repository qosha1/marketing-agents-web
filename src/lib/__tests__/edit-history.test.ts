/**
 * The edit log's whole job is to survive an AUTOSAVE (bd startsim-j9rxf).
 *
 * The draft editor writes on a 1200ms debounce, so a reviewer editing a 500-word
 * blog produces dozens of PATCHes. A row per PATCH is noise, not accountability —
 * so the collapsing rule is what these tests are actually about. Every other case
 * here (shape tolerance, the cap, the unknown editor) exists so the collapse can
 * never be the thing that crashes or lies.
 */
import { describe, it, expect } from 'vitest';

import {
  COLLAPSE_WINDOW_MS,
  EDIT_HISTORY_ATTR,
  EDIT_HISTORY_PATCH_KEY,
  MAX_EDIT_ENTRIES,
  editSummary,
  lastEdit,
  readEditHistory,
  recordEdit,
  type EditEntry,
} from '@/lib/edit-history';

const ADA = 'ada@startsimpli.com';
const GRACE = 'grace@startsimpli.com';

/** An ISO instant `ms` after the fixed base — so a window boundary is exact. */
const BASE = Date.parse('2026-09-09T10:00:00.000Z');
const at = (ms: number) => new Date(BASE + ms).toISOString();

/** Replay a series of saves through `recordEdit`, as the page does. */
function replay(saves: Array<[by: string | undefined, ms: number]>): EditEntry[] {
  return saves.reduce<EditEntry[]>((h, [by, ms]) => recordEdit(h, by, at(ms)), []);
}

describe('recordEdit — collapsing consecutive saves', () => {
  it('records the first save as one entry whose span is a point in time', () => {
    const h = replay([[ADA, 0]]);
    expect(h).toEqual([{ by: ADA, from: at(0), at: at(0), saves: 1 }]);
  });

  it('COLLAPSES a debounced burst by one person into a single entry', () => {
    // Twelve saves 1.2s apart — one sitting at the keyboard, not twelve edits.
    const h = replay(Array.from({ length: 12 }, (_, i): [string, number] => [ADA, i * 1200]));
    expect(h).toHaveLength(1);
    expect(h[0]).toEqual({ by: ADA, from: at(0), at: at(11 * 1200), saves: 12 });
  });

  it('keeps the span open at the window edge and starts a new entry past it', () => {
    const inside = replay([
      [ADA, 0],
      [ADA, COLLAPSE_WINDOW_MS],
    ]);
    expect(inside).toHaveLength(1);
    expect(inside[0]?.saves).toBe(2);

    const outside = replay([
      [ADA, 0],
      [ADA, COLLAPSE_WINDOW_MS + 1],
    ]);
    expect(outside).toHaveLength(2);
    expect(outside[1]).toEqual({
      by: ADA,
      from: at(COLLAPSE_WINDOW_MS + 1),
      at: at(COLLAPSE_WINDOW_MS + 1),
      saves: 1,
    });
  });

  it('NEVER collapses two different people, however close together they save', () => {
    const h = replay([
      [ADA, 0],
      [GRACE, 1200],
      [ADA, 2400],
    ]);
    expect(h.map((e) => e.by)).toEqual([ADA, GRACE, ADA]);
    expect(h.every((e) => e.saves === 1)).toBe(true);
  });

  it('keeps the entries oldest-first so the array is append-only', () => {
    const h = replay([
      [ADA, 0],
      [GRACE, COLLAPSE_WINDOW_MS * 2],
    ]);
    expect(h.map((e) => e.at)).toEqual([at(0), at(COLLAPSE_WINDOW_MS * 2)]);
  });

  it('takes the window as an argument so one constant moves the whole behaviour', () => {
    // The open question (per-save or per-sitting?) is this number and nothing
    // else — 0 gives a row per save, a bigger number gives a row per visit.
    const perSave = recordEdit([{ by: ADA, from: at(0), at: at(0), saves: 1 }], ADA, at(1), 0);
    expect(perSave).toHaveLength(2);
  });
});

describe('recordEdit — an editor we cannot name', () => {
  it('still records the edit, unattributed: the time is true even when the name is not known', () => {
    const h = replay([[undefined, 0]]);
    expect(h).toHaveLength(1);
    expect(h[0]?.by).toBeUndefined();
    expect(h[0]?.at).toBe(at(0));
  });

  it('treats a blank email as unknown rather than as a person with a blank name', () => {
    const h = recordEdit([], '   ', at(0));
    expect(h[0]?.by).toBeUndefined();
  });

  it('collapses consecutive unattributed saves — an unnamed editor is still ONE sitting', () => {
    const h = replay([
      [undefined, 0],
      [undefined, 1200],
    ]);
    expect(h).toHaveLength(1);
    expect(h[0]?.saves).toBe(2);
  });

  it('does not fold a named editor into an unnamed entry', () => {
    const h = replay([
      [undefined, 0],
      [ADA, 1200],
    ]);
    expect(h).toHaveLength(2);
  });
});

describe('recordEdit — the cap', () => {
  it('keeps the NEWEST entries and drops the oldest', () => {
    // Each save is its own entry: same person, but every one past the window.
    const saves = Array.from(
      { length: MAX_EDIT_ENTRIES + 5 },
      (_, i): [string, number] => [ADA, i * (COLLAPSE_WINDOW_MS + 1)],
    );
    const h = replay(saves);
    expect(h).toHaveLength(MAX_EDIT_ENTRIES);
    expect(h[0]?.at).toBe(at(5 * (COLLAPSE_WINDOW_MS + 1)));
    expect(h[h.length - 1]?.at).toBe(at((MAX_EDIT_ENTRIES + 4) * (COLLAPSE_WINDOW_MS + 1)));
  });
});

describe('readEditHistory — shape tolerance', () => {
  it('reads the camelCased key the shared API client actually returns', () => {
    const entry: EditEntry = { by: ADA, from: at(0), at: at(0), saves: 1 };
    expect(readEditHistory({ [EDIT_HISTORY_PATCH_KEY]: [entry] })).toEqual([entry]);
  });

  it('reads the raw wire key too, for a blob that never went through the client', () => {
    const entry: EditEntry = { by: ADA, from: at(0), at: at(0), saves: 1 };
    expect(readEditHistory({ [EDIT_HISTORY_ATTR]: [entry] })).toEqual([entry]);
  });

  it('reads absence, a non-array and junk as NO history rather than crashing', () => {
    expect(readEditHistory(undefined)).toEqual([]);
    expect(readEditHistory({})).toEqual([]);
    expect(readEditHistory({ [EDIT_HISTORY_PATCH_KEY]: 'yesterday' })).toEqual([]);
    expect(readEditHistory({ [EDIT_HISTORY_PATCH_KEY]: { at: at(0) } })).toEqual([]);
  });

  it('drops entries with no usable timestamp and keeps the rest', () => {
    const good: EditEntry = { by: ADA, from: at(0), at: at(0), saves: 1 };
    const read = readEditHistory({
      [EDIT_HISTORY_PATCH_KEY]: [null, 'nope', { by: ADA }, { at: 'not a date' }, good],
    });
    expect(read).toEqual([good]);
  });

  it('repairs a partial entry rather than dropping it — the timestamp is the point', () => {
    const read = readEditHistory({ [EDIT_HISTORY_PATCH_KEY]: [{ at: at(0) }] });
    expect(read).toEqual([{ from: at(0), at: at(0), saves: 1 }]);
  });

  it('appends onto a history read back from the wire', () => {
    const stored = readEditHistory({
      [EDIT_HISTORY_PATCH_KEY]: [{ by: ADA, from: at(0), at: at(0), saves: 1 }],
    });
    const next = recordEdit(stored, ADA, at(1200));
    expect(next).toHaveLength(1);
    expect(next[0]?.saves).toBe(2);
  });
});

describe('editSummary + lastEdit — what the panel says', () => {
  it('says nothing extra about a single save', () => {
    expect(editSummary({ by: ADA, from: at(0), at: at(0), saves: 1 })).toBe('1 save');
  });

  it('says how many saves the entry collapsed, and over how long', () => {
    expect(editSummary({ by: ADA, from: at(0), at: at(240_000), saves: 12 })).toBe(
      '12 saves over 4 min',
    );
  });

  it('omits a sub-minute span rather than printing "over 0 min"', () => {
    expect(editSummary({ by: ADA, from: at(0), at: at(30_000), saves: 5 })).toBe('5 saves');
  });

  it('lastEdit is the newest entry, and undefined when nothing has been edited', () => {
    const h = replay([
      [ADA, 0],
      [GRACE, COLLAPSE_WINDOW_MS * 2],
    ]);
    expect(lastEdit(h)?.by).toBe(GRACE);
    expect(lastEdit([])).toBeUndefined();
  });
});

describe('the wire spelling', () => {
  it('writes under the SAME key the client hands back, so the patch overrides cleanly', () => {
    // The blob spread into a PATCH already holds `EditHistory`; writing
    // `_edit_history` alongside it leaves BOTH, and they collide on the wire.
    expect(EDIT_HISTORY_PATCH_KEY).toBe('EditHistory');
    expect(EDIT_HISTORY_ATTR).toBe('_edit_history');
    // camelToSnake in @startsimpli/api turns each [A-Z] into _<lower>.
    expect(EDIT_HISTORY_PATCH_KEY.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)).toBe(
      EDIT_HISTORY_ATTR,
    );
  });
});
