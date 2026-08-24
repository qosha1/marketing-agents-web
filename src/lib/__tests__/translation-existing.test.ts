/**
 * Does a translation of this draft into this language already exist? (wn2p.21)
 *
 * WHY A QUERY AND NOT THE external_id GUARD. The durable key stops a duplicate,
 * but only from the SAME person. Measured live 2026-08-24 — the unique
 * constraint is (org_id, entity_type, external_id, owner_sub), and `owner_sub`
 * is part of it:
 *
 *   same owner,      same external_id  ->  400 conflict: duplicate key value
 *   different owner, same external_id  ->  201 Created
 *
 * So two people, or one person and an automatic trigger running as someone else,
 * each get a translation and the reviewer sees two. The database cannot answer
 * this one; the edge can.
 *
 * It also runs BEFORE the model, which is the other half of the point: a
 * duplicate press currently pays for a full translation and then discards it.
 */
import { describe, expect, it } from 'vitest';

import { existingTranslationQuery } from '@/lib/draft-translation';

describe('existingTranslationQuery', () => {
  it('asks for drafts linked to this source by a translation_of edge, in this language', () => {
    // VERIFIED against the live tenant: this exact query returns count 1 for zh
    // and count 0 for ar on draft 0e7b1055.
    expect(existingTranslationQuery('0e7b1055', 'zh')).toBe(
      'entities?type=draft&related_to=0e7b1055&related_via=translation_of' +
        '&related_direction=out&attr.lang=zh&page_size=1',
    );
  });

  it('scopes to ONE language — a zh translation must not block an ar one', () => {
    expect(existingTranslationQuery('src', 'ar')).toContain('attr.lang=ar');
    expect(existingTranslationQuery('src', 'ar')).not.toContain('attr.lang=zh');
  });

  it('asks for a single row: this is a yes/no, and the count comes from the envelope', () => {
    expect(existingTranslationQuery('src', 'zh')).toContain('page_size=1');
  });

  it('escapes values rather than pasting them into the query string', () => {
    // URLSearchParams spells a space `+`, which is correct for a query string;
    // what matters is that `&` and `=` cannot break out of the parameter.
    const q = existingTranslationQuery('a b&c=d', 'zh');
    expect(q).toContain('related_to=a+b%26c%3Dd');
    expect(q).not.toContain('related_to=a b&c=d');
  });

  it('names the direction explicitly — the default is not the one it reads like', () => {
    // `related_direction=in` returns 0 rows for this shape; the translation is
    // the row holding the OUTGOING edge to its source. Measured, not assumed.
    expect(existingTranslationQuery('src', 'zh')).toContain('related_direction=out');
  });
});
