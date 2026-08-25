/**
 * A translation has to be findable forever (bd startsim-wn2p.21).
 *
 * WHAT WAS MEASURED, live, 2026-08-24. Exactly 2 of 77 drafts carry a blank
 * `external_id`, and they are the only two translations in the tenant — the zh
 * and the ar. Every one of the other 75, all robot-written originals, has a real
 * slug. So the blank is not incidental; it is specifically what the translation
 * path produces, and it is 100% of translations.
 *
 * WHY BLANK IS THE WORST POSSIBLE VALUE. The partial unique constraint
 * `uniq_entity_external_id_per_org_type_owner` is declared
 * `condition=~Q(external_id="")` — blank rows are EXEMPT. So the database will
 * accept unlimited translations of the same draft into the same language, and
 * nothing can address one afterwards to update or replace it. The only guard
 * today is `translatableTargets()` hiding a button, which stops a careful human
 * and nothing else.
 *
 * WHY THE OBVIOUS FIX IS THE BUG. `slugForHeadline` collapses a CJK or Arabic
 * headline to '' (its own docstring records this), so keying a translation off
 * its OWN name reproduces the blank exactly. The key has to come from the
 * SOURCE, which is Latin-slugged, plus the target locale.
 */
import { describe, expect, it } from 'vitest';

import { translationExternalId } from '@/lib/draft-translation';
import type { EntityRecord } from '@/lib/foundry-api';

function draft(over: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: '0e7b1055-8f43-4089-9e65-0f765e89d17e',
    entityType: 'draft',
    externalId: 'china-gulf-tech-expansion-raises-execution-questions-for-entrants',
    name: 'China-Gulf Tech Expansion Raises Execution Questions for Entrants',
    data: {},
    createdAt: '2026-08-19',
    ...over,
  } as EntityRecord;
}

describe('translationExternalId', () => {
  it('keys off the SOURCE and the locale, so a CJK title cannot blank it', () => {
    expect(translationExternalId(draft(), 'zh')).toBe(
      'china-gulf-tech-expansion-raises-execution-questions-for-entrants@zh',
    );
  });

  it('gives each language its own key, so zh and ar coexist', () => {
    const zh = translationExternalId(draft(), 'zh');
    const ar = translationExternalId(draft(), 'ar');
    expect(zh).not.toBe(ar);
  });

  it('is stable — the same source and locale always produce the same key', () => {
    expect(translationExternalId(draft(), 'zh')).toBe(translationExternalId(draft(), 'zh'));
  });

  it('is IDEMPOTENT against the live constraint: a second translation collides', () => {
    // This is the whole point. Two attempts at the same (source, locale) produce
    // the same external_id, so the second POST is refused by
    // uniq_entity_external_id_per_org_type_owner instead of silently creating a
    // rival record the UI will show as a competing translation.
    const first = translationExternalId(draft(), 'zh');
    const second = translationExternalId(draft(), 'zh');
    expect(first).toBe(second);
  });

  it('falls back to the source id when the source itself has no external_id', () => {
    // Both live translations are in exactly this state, so a translation OF a
    // translation — or a backfill of one — must still get a real key.
    const key = translationExternalId(draft({ externalId: '' }), 'zh');
    expect(key).toBe('0e7b1055-8f43-4089-9e65-0f765e89d17e@zh');
    expect(key).not.toBe('');
  });

  it('handles a null external_id the same way', () => {
    expect(translationExternalId(draft({ externalId: null }), 'zh')).toContain('@zh');
  });

  it('NEVER returns blank — blank is the one value the constraint ignores', () => {
    const cases: EntityRecord[] = [
      draft({ externalId: '' }),
      draft({ externalId: null }),
      draft({ externalId: '   ' }),
      draft({ name: '中国—海湾科技扩张', externalId: '' }),
    ];
    for (const d of cases) {
      expect(translationExternalId(d, 'zh')).not.toBe('');
    }
  });

  it('stays inside the column, which is 255 chars', () => {
    const long = 'a'.repeat(400);
    const key = translationExternalId(draft({ externalId: long }), 'zh');
    expect(key.length).toBeLessThanOrEqual(255);
    // The locale survives the truncation — losing it would merge zh into ar.
    expect(key.endsWith('@zh')).toBe(true);
  });

  it('two long sources sharing a prefix still get different keys', () => {
    // Truncating the head would silently merge them; the key keeps the TAIL of
    // the source, which is where a slug actually differs.
    const a = translationExternalId(draft({ externalId: 'x'.repeat(300) + 'alpha' }), 'zh');
    const b = translationExternalId(draft({ externalId: 'x'.repeat(300) + 'beta' }), 'zh');
    expect(a).not.toBe(b);
  });

  it('refuses to key a translation with no locale rather than inventing one', () => {
    expect(() => translationExternalId(draft(), '')).toThrow();
    expect(() => translationExternalId(draft(), '   ')).toThrow();
  });
});

describe('translationExternalId reads the wire shape too', () => {
  // MEASURED: the first live translation created after this feature shipped got
  // `a7e009c3-...@zh` — the source's UUID — not the slug the docstring promises.
  // The route fetches the draft with a raw JSON.parse over the tenant response,
  // so the object carries `external_id`, and only the shared browser client
  // camelCases it to `externalId`. Reading one spelling meant the fallback ran
  // 100% of the time: a valid key, but never the intended one.
  it('accepts the snake_case external_id the tenant actually sends', () => {
    const wire = {
      id: 'a7e009c3-b963-4229-bfb8-8709861acbb0',
      external_id: 'uae-digital-licensing-tools-are-reshaping-market-entry',
      name: 'UAE digital licensing tools',
      data: {},
    } as unknown as EntityRecord;
    expect(translationExternalId(wire, 'zh')).toBe(
      'uae-digital-licensing-tools-are-reshaping-market-entry@zh',
    );
  });

  it('prefers the camelCase spelling when both are present', () => {
    const both = {
      id: 'x',
      externalId: 'camel',
      external_id: 'snake',
      name: 'n',
      data: {},
    } as unknown as EntityRecord;
    expect(translationExternalId(both, 'zh')).toBe('camel@zh');
  });

  it('still falls back to the id when neither spelling carries a value', () => {
    const neither = { id: 'only-an-id', name: 'n', data: {} } as unknown as EntityRecord;
    expect(translationExternalId(neither, 'zh')).toBe('only-an-id@zh');
  });
});
