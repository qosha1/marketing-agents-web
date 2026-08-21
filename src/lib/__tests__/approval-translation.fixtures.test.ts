/**
 * Unmarked companion to approval-translation.test.ts (bd startsim-wn2p.9).
 *
 * The RED file's markers are keyed on the stub throwing, and `it.fails` passes
 * on ANY throw. So if the import were ever resolved against the wrong module —
 * or the suite run where the `@/` alias points elsewhere — every marked test
 * would "pass" as an expected failure and the RED would arm silently against
 * nothing. These assertions pin the identity of the thing being probed.
 *
 * They pass TODAY and must keep passing, which is what makes them a floor rather
 * than a marker. Per the house split they live in their own unmarked file: a
 * strict `it.fails` cannot hold a test that already passes.
 */
import { describe, expect, it } from 'vitest';

import {
  APPROVED_STATUS,
  AutoTranslationNotImplementedError,
  CREATED_DRAFT,
  translationOnApproval,
} from '@/lib/approval-translation';

describe('approval-translation module identity', () => {
  it('is the module this suite thinks it is', () => {
    expect(APPROVED_STATUS).toBe('approved');
    expect(AutoTranslationNotImplementedError).toBeTypeOf('function');
  });

  it('throws a NAMED error, so the RED markers key on something specific', () => {
    const err = new AutoTranslationNotImplementedError('probe');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AutoTranslationNotImplementedError');
    expect(err.message).toContain('startsim-wn2p.10');
  });

  it('is a different error from the one the status vocabulary throws', () => {
    // Both stubs are in play at once (wn2p.2 owns the other). Keying a marker on
    // the wrong one would arm this suite against a module it does not test.
    expect(new AutoTranslationNotImplementedError('probe').name).not.toBe(
      'DraftStatusNotImplementedError',
    );
  });
});

describe('the shape the trigger has to have', () => {
  it('decides from a context object alone, so both approval paths can ask it', () => {
    // Approval happens in TWO places: `accept()` in the draft editor and the
    // kanban drag in `entity-board.tsx`, which PATCHes the status attribute
    // directly. A decision that needed a router, a query client or a fetch could
    // only ever serve one of them.
    expect(translationOnApproval).toBeTypeOf('function');
    expect(translationOnApproval.length).toBe(1);
  });

  it('marks the not-yet-created draft with a sentinel no record id can collide with', () => {
    // The link write is composed before the create runs, so its source cannot be
    // a real id yet. Entity ids are numbers; this is deliberately not one.
    expect(CREATED_DRAFT).toBeTypeOf('string');
    expect(Number.isNaN(Number(CREATED_DRAFT))).toBe(true);
  });
});
