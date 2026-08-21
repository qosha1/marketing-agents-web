/**
 * Unmarked companion to draft-status.test.ts (bd startsim-wn2p.1).
 *
 * The RED file's markers are keyed on the stub throwing. If the import were
 * ever resolved against the wrong module — or the suite run from a directory
 * where the alias points elsewhere — every marked test would "pass" as an
 * expected failure and the RED would arm silently against nothing.
 *
 * These assertions pass TODAY and must keep passing, which is what makes them
 * a floor rather than a marker. Per the house split, they live in their own
 * unmarked file: a strict `it.fails` cannot hold a test that already passes.
 */
import { describe, expect, it } from 'vitest';

import { DraftStatusNotImplementedError, STATUS_ATTR } from '@/lib/draft-status';

describe('draft-status module identity', () => {
  it('is the module this suite thinks it is', () => {
    expect(STATUS_ATTR).toBe('status');
    expect(DraftStatusNotImplementedError).toBeTypeOf('function');
  });

  it('throws a NAMED error, so the RED markers key on something specific', () => {
    const err = new DraftStatusNotImplementedError('probe');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DraftStatusNotImplementedError');
    expect(err.message).toContain('startsim-wn2p.2');
  });
});
