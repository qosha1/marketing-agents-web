/**
 * Unmarked companion to title-durability.test.ts (bd startsim-wn2p.16).
 *
 * The RED file's markers are keyed on the stub throwing. If the import were ever
 * resolved against the wrong module — or the suite run from a directory where
 * the alias points elsewhere — every marked test would "pass" as an expected
 * failure and the RED would arm silently against nothing.
 *
 * These assertions pass TODAY and must keep passing, which is what makes them a
 * floor rather than a marker. Per the house split, they live in their own
 * unmarked file: a strict `it.fails` cannot hold a test that already passes.
 */
import { describe, expect, it } from 'vitest';

import {
  MERGING_UPSERT_PATH,
  TITLE_DATA_FIELDS,
  TITLE_NAME_FIELD,
  TitleDurabilityNotImplementedError,
} from '@/lib/title-durability';

describe('title-durability module identity', () => {
  it('is the module this suite thinks it is', () => {
    expect(TITLE_NAME_FIELD).toBe('name');
    expect(TitleDurabilityNotImplementedError).toBeTypeOf('function');
  });

  it('throws a NAMED error, so the RED markers key on something specific', () => {
    const err = new TitleDurabilityNotImplementedError('probe');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TitleDurabilityNotImplementedError');
    expect(err.message).toContain('startsim-wn2p.16');
  });
});

describe('the shape of a draft’s title, as OGMC models it', () => {
  it('names the three data-blob pieces the tracker asks to be editable', () => {
    // Short title + subtitle + angle, per the tracker spreadsheet. `story_title`
    // is what the drawer renders under the "Title" column header.
    expect([...TITLE_DATA_FIELDS]).toEqual(['story_title', 'subheadline', 'angle']);
  });

  it('keeps the name COLUMN out of that list, because merge does not cover it', () => {
    // The distinction is the whole point of this bead: omitting a `data` key is
    // enough to preserve it, omitting `name` is a separate act. Folding `name`
    // into TITLE_DATA_FIELDS would hide that.
    expect([...TITLE_DATA_FIELDS]).not.toContain(TITLE_NAME_FIELD);
  });

  it('points at the endpoint that merges rather than the one that creates', () => {
    // `/api/v1/entities/` is a plain create — a repeat external_id for the same
    // owner is a 400 conflict, never an update. Verified live 2026-08-21.
    expect(MERGING_UPSERT_PATH).toBe('api/v1/entities/upsert');
    expect(MERGING_UPSERT_PATH).not.toMatch(/\/$/);
  });
});
