/**
 * RED for the draft <-> segment seam (bd startsim-bxkd).
 *
 * The engine in `@startsimpli/llm/translation` takes `{ id, text }` segments with
 * ids IT NEVER INTERPRETS, and the caller owns extraction and reassembly
 * (`startsim-jb1z`: "structure never enters the model"). This file pins THIS
 * app's half of that contract — which draft fields are prose, which are carried
 * through untouched, and what the translated draft's data blob looks like.
 *
 * Pure on both sides, so it runs with no backend and no provider, exactly like
 * `topic-drafts.ts`'s matching logic. The route handler stays thin enough that
 * it needs no suite of its own.
 *
 * FIELD NAMES ARE NOT GUESSES. They were read off the LIVE marketing-agents
 * tenant on 2026-08-19 (ECS exec, inside `org_scope("marketing-agents")`):
 *   draft attrs — content_type(enum), candidate_index(int), blog(longtext),
 *   linkedin(longtext), seo(json), sources(json), judge_verdict(json),
 *   auto_checks(json), chosen(bool), status(enum), sent_at(date),
 *   lang(enum: en|ar), assignee_sub(text), assignee_name(text)
 *   rel defs — grounded_by, for_client, written_for, translation_of
 */
import { describe, expect, it } from 'vitest';

import {
  applyDraftTranslations,
  declaredLangChoices,
  translatableTargets,
  draftSegments,
  TRANSLATED_STATUS,
} from '@/lib/draft-translation';
import type { EntityRecord } from '@/lib/foundry-api';

/** A draft shaped like a live one, with every field class represented. */
function sourceDraft(): EntityRecord {
  return {
    id: 114,
    name: 'Gulf logistics rebound',
    entityType: 'draft',
    externalId: 'draft-114',
    data: {
      content_type: 'weekly_brief',
      topic_ref: 42,
      candidate_index: 2,
      chosen: true,
      status: 'approved',
      lang: 'en',
      blog: 'Revenue grew 12.5% across the corridor.',
      linkedin: 'A short post about the corridor.',
      seo: { meta_description: 'How the corridor recovered.', tags: 'logistics,gulf' },
      sources: ['https://reuters.com/a', 'https://ft.com/b'],
      judge_verdict: { score: 8 },
      auto_checks: { ok: true },
      assignee_sub: 'sub-nordby',
      assignee_name: 'nordby@ogmc.ai',
    },
  } as unknown as EntityRecord;
}

describe('draftSegments — what actually goes to the model', () => {
  it('extracts the prose fields and the headline', () => {
    const segments = draftSegments(sourceDraft());
    const byId = Object.fromEntries(segments.map((s) => [s.id, s.text]));

    expect(byId.name).toBe('Gulf logistics rebound');
    expect(byId.blog).toBe('Revenue grew 12.5% across the corridor.');
    expect(byId.linkedin).toBe('A short post about the corridor.');
    expect(byId['seo.meta_description']).toBe('How the corridor recovered.');
  });

  it('never offers URLs or machine fields to the model', () => {
    // Sources are URLs and the rest are scores, flags and ids. Translating any
    // of them is a defect, not a nicety — and the cheapest way to guarantee it
    // is to never put them in the prompt.
    const ids = draftSegments(sourceDraft()).map((s) => s.id);

    for (const forbidden of [
      'sources',
      'judge_verdict',
      'auto_checks',
      'chosen',
      'candidate_index',
      'topic_ref',
      'content_type',
      'status',
      'lang',
      'seo.tags',
    ]) {
      expect(ids).not.toContain(forbidden);
    }
  });

  it('skips fields that are absent or blank rather than sending empty segments', () => {
    const draft = sourceDraft();
    (draft.data as Record<string, unknown>).linkedin = '   ';
    delete (draft.data as Record<string, unknown>).seo;

    const ids = draftSegments(draft).map((s) => s.id);

    expect(ids).toContain('blog');
    expect(ids).not.toContain('linkedin');
    expect(ids).not.toContain('seo.meta_description');
  });

  it('reads camelCased keys too, because the client transforms responses', () => {
    // The shared api client camelCases the data blob on arrival, so a live
    // `seo.meta_description` can show up as `metaDescription` — the same trap
    // board.ts and content-checks.ts already handle.
    const draft = sourceDraft();
    (draft.data as Record<string, unknown>).seo = { metaDescription: 'Camel form.' };

    const byId = Object.fromEntries(draftSegments(draft).map((s) => [s.id, s.text]));

    expect(byId['seo.meta_description']).toBe('Camel form.');
  });
});

describe('applyDraftTranslations — the new draft that gets created', () => {
  const translated = new Map([
    ['name', 'عنوان مترجم'],
    ['blog', 'نمت الإيرادات 12.5% عبر الممر.'],
    ['linkedin', 'منشور قصير عن الممر.'],
    ['seo.meta_description', 'كيف تعافى الممر.'],
  ]);

  it('writes the translated prose into the new draft', () => {
    const next = applyDraftTranslations(sourceDraft(), translated, 'ar');

    expect(next.name).toBe('عنوان مترجم');
    expect(next.data.blog).toBe('نمت الإيرادات 12.5% عبر الممر.');
    expect(next.data.linkedin).toBe('منشور قصير عن الممر.');
    expect((next.data.seo as Record<string, unknown>).meta_description).toBe(
      'كيف تعافى الممر.',
    );
  });

  it('stamps the target language and starts the translation in drafting', () => {
    // A translation is NEW work for a reviewer, not an approved artifact that
    // inherits the source's verdict.
    const next = applyDraftTranslations(sourceDraft(), translated, 'ar');

    expect(next.data.lang).toBe('ar');
    expect(next.data.status).toBe(TRANSLATED_STATUS);
    expect(TRANSLATED_STATUS).toBe('drafting');
  });

  it('carries the classification across so the piece lands in its own section', () => {
    // startsim-ylbz's whole point: a lead_magnet translation that says
    // weekly_brief is invisible in its own content tab.
    const draft = sourceDraft();
    (draft.data as Record<string, unknown>).content_type = 'lead_magnet';

    const next = applyDraftTranslations(draft, translated, 'ar');

    expect(next.data.content_type).toBe('lead_magnet');
    expect(next.data.topic_ref).toBe(42);
    expect(next.data.sources).toEqual(['https://reuters.com/a', 'https://ft.com/b']);
  });

  it('does NOT inherit the source draft review state or its assignee', () => {
    // Inheriting judge_verdict would show a quality verdict for text the judge
    // never saw; inheriting the assignee silently hands someone work they did
    // not take. Both must be earned again.
    const next = applyDraftTranslations(sourceDraft(), translated, 'ar');

    for (const key of [
      'judge_verdict',
      'auto_checks',
      'chosen',
      'candidate_index',
      'sent_at',
      'assignee_sub',
      'assignee_name',
    ]) {
      expect(next.data).not.toHaveProperty(key);
    }
  });

  it('leaves a field untranslated rather than blanking it when the model skipped it', () => {
    // A partial result is a readable draft with gaps. Writing '' would destroy
    // the source text the reviewer needs to fix it.
    const partial = new Map([['blog', 'نص مترجم.']]);

    const next = applyDraftTranslations(sourceDraft(), partial, 'ar');

    expect(next.data.blog).toBe('نص مترجم.');
    expect(next.data.linkedin).toBe('A short post about the corridor.');
    expect(next.name).toBe('Gulf logistics rebound');
  });

  it('does not mutate the source draft', () => {
    const draft = sourceDraft();
    applyDraftTranslations(draft, translated, 'ar');

    expect(draft.name).toBe('Gulf logistics rebound');
    expect(draft.data.blog).toBe('Revenue grew 12.5% across the corridor.');
    expect(draft.data.lang).toBe('en');
  });
});

describe('which languages are still on offer (bd startsim-tetf)', () => {
  const draftType = {
    key: 'draft',
    attributes: [
      { name: 'status', dataType: 'enum', config: { choices: ['drafting', 'ready'] } },
      { name: 'lang', dataType: 'enum', config: { choices: ['en', 'ar', 'zh'] } },
    ],
  } as unknown as Parameters<typeof declaredLangChoices>[0];

  it('reads the choices off the runtime schema, not a list in the code', () => {
    // This is what makes adding a language a schema change and nothing else.
    expect(declaredLangChoices(draftType)).toEqual(['en', 'ar', 'zh']);
  });

  it('is empty when the type declares no lang attribute, so nothing is offered', () => {
    expect(declaredLangChoices({ key: 'draft', attributes: [] } as never)).toEqual([]);
    expect(declaredLangChoices(null)).toEqual([]);
  });

  it('offers only languages the group does not already have', () => {
    // The source is en and an ar translation exists, so zh is the only one left.
    expect(translatableTargets(['en', 'ar', 'zh'], ['en', 'ar'])).toEqual(['zh']);
  });

  it('never offers the language the draft is already in', () => {
    expect(translatableTargets(['en', 'ar'], ['en'])).toEqual(['ar']);
  });

  it('offers nothing once every declared language exists', () => {
    // The control must disappear rather than create a competing second copy.
    expect(translatableTargets(['en', 'ar'], ['en', 'ar'])).toEqual([]);
  });

  it('ignores blank languages rather than offering an empty chip', () => {
    expect(translatableTargets(['en', 'ar', ''], ['', 'en'])).toEqual(['ar']);
  });
});
