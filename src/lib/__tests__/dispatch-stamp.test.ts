/**
 * The dispatch stamp — the one fact the n8n poll cannot work out for itself
 * (bd startsim-m7fdm.19, constraint 4).
 *
 * WHY THESE ARE WORTH TESTS AT ALL, when the module is four small functions.
 * Everything this stamp protects is invisible when it breaks. A window that is
 * read wrong does not throw; it lets the 6-hourly poll dispatch a writer that is
 * already running, and the only symptom is two near-duplicate drafts in a
 * customer's review queue some hours later — which is exactly how the six drafts
 * of bd startsim-8hgmq.3 reached a reviewer before anyone noticed the cause.
 *
 * AND ONE OF THEM GUARDS A DELETION. `withDispatchStamp` exists because the
 * tenant's PATCH REPLACES the `data` blob: a body carrying only this key would
 * empty the topic. "It keeps every other key" is therefore not a nicety, it is
 * the whole reason the function is not an inline object literal.
 */
import { describe, expect, it } from 'vitest';

import {
  DISPATCH_STAMP_ATTR,
  DISPATCH_STAMP_TTL_MS,
  dispatchInFlight,
  dispatchStampedAt,
  withDispatchStamp,
} from '../dispatch-stamp';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');

/** A blob carrying a stamp `ms` milliseconds before NOW. */
function stamped(ms: number, key: string = DISPATCH_STAMP_ATTR) {
  return { status: 'ready', [key]: new Date(NOW - ms).toISOString() };
}

describe('dispatchStampedAt', () => {
  it('reads the stamp the route writes', () => {
    expect(dispatchStampedAt(stamped(0))).toBe(NOW);
  });

  it('reads it through the shared client’s camelCase transform too', () => {
    // The blob stores `_drafts_dispatched_at`; the browser client hands the same
    // row back as `DraftsDispatchedAt`. A reader that knew only one spelling
    // would be right on the server and wrong in the browser — the trap
    // `draft-origin.ts` documents for `_trigger`.
    expect(dispatchStampedAt(stamped(0, 'DraftsDispatchedAt'))).toBe(NOW);
  });

  it('treats absence, blankness and an unreadable value as NO stamp', () => {
    expect(dispatchStampedAt(undefined)).toBeNull();
    expect(dispatchStampedAt({})).toBeNull();
    expect(dispatchStampedAt({ [DISPATCH_STAMP_ATTR]: '   ' })).toBeNull();
    // Not 0. A stamp nobody can parse must not become a stamp from 1970 — that
    // reads as expired, which is the safe direction only by accident.
    expect(dispatchStampedAt({ [DISPATCH_STAMP_ATTR]: 'yesterday-ish' })).toBeNull();
    expect(dispatchStampedAt({ [DISPATCH_STAMP_ATTR]: 1759752000000 })).toBeNull();
  });
});

describe('dispatchInFlight', () => {
  it('is true inside the window — the writer could still be running', () => {
    expect(dispatchInFlight(stamped(0), NOW)).toBe(true);
    expect(dispatchInFlight(stamped(DISPATCH_STAMP_TTL_MS - 1), NOW)).toBe(true);
  });

  it('is false once the window closes, so the poll is the safety net again', () => {
    // THIS IS THE "what if the writer never finishes" ANSWER. A stamp that never
    // aged would stand the 6-hourly net down for good on a topic whose writer
    // died silently in n8n: ready, no draft, and nothing left to pick it up.
    expect(dispatchInFlight(stamped(DISPATCH_STAMP_TTL_MS), NOW)).toBe(false);
    expect(dispatchInFlight(stamped(24 * 3_600_000), NOW)).toBe(false);
  });

  it('is false for a topic that was never dispatched', () => {
    expect(dispatchInFlight({ status: 'ready' }, NOW)).toBe(false);
  });

  it('counts a stamp from the FUTURE as in flight', () => {
    // Clock skew between this app and whatever wrote the stamp is not a reason
    // to fire a second writer, and the window closes on its own regardless.
    expect(dispatchInFlight(stamped(-60_000), NOW)).toBe(true);
  });
});

describe('withDispatchStamp', () => {
  it('KEEPS every other key — the tenant PATCH replaces the blob', () => {
    const before = { status: 'ready', title: 'Qatar customs', source_1: 'https://example.com' };
    const after = withDispatchStamp(before, NOW);
    expect(after).toMatchObject(before);
    expect(after[DISPATCH_STAMP_ATTR]).toBe('2026-10-06T12:00:00.000Z');
  });

  it('does not mutate the blob it was handed', () => {
    const before = { status: 'ready' };
    withDispatchStamp(before, NOW);
    expect(before).toEqual({ status: 'ready' });
  });

  it('overwrites an older stamp rather than accumulating', () => {
    const after = withDispatchStamp(stamped(10 * 60_000), NOW);
    expect(dispatchStampedAt(after)).toBe(NOW);
  });

  it('writes an ISO string, which is what the n8n poll can Date.parse', () => {
    expect(typeof withDispatchStamp({}, NOW)[DISPATCH_STAMP_ATTR]).toBe('string');
    expect(Date.parse(String(withDispatchStamp({}, NOW)[DISPATCH_STAMP_ATTR]))).toBe(NOW);
  });

  it('survives an absent blob', () => {
    expect(dispatchStampedAt(withDispatchStamp(undefined, NOW))).toBe(NOW);
  });
});
