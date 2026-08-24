/**
 * This app's half of the translation contract (bd startsim-bxkd).
 *
 * The engine (`@startsimpli/llm/translation`) is format-agnostic on purpose:
 * it takes `{ id, text }` segments whose ids it never interprets, and the CALLER
 * owns extraction and reassembly, because `startsim-jb1z` keeps document
 * structure out of the model entirely. This file is that caller's half for a
 * `draft` record, and it is pure so it unit-tests with no backend and no
 * provider — the same shape `topic-drafts.ts` uses for its matching logic.
 *
 * FIELD NAMES READ OFF THE LIVE TENANT (ECS exec inside org_scope, 2026-08-19),
 * not inferred: blog/linkedin are longtext, seo/sources are json, and lang is an
 * enum declared `en|ar`. The target locale is NOT hardcoded here — it arrives
 * per request and is validated against whatever the live schema declares, so
 * adding `zh` for OGMC's WeChat channel is a schema change and nothing else.
 */
import type { EntityRecord, EntityTypeDef } from '@/lib/foundry-api';

/**
 * A translation starts as new work for a reviewer, never as an approved artifact.
 *
 * The team's vocabulary (bd startsim-wn2p.2) names that state `ready_for_review`
 * — nobody has looked at it yet. It is deliberately NOT `approved`: the source
 * draft's approval is what CAUSED this translation, and inheriting it would skip
 * the CN review the diagram draws as stage 5.
 */
export const TRANSLATED_STATUS = 'ready_for_review';

/** The declared attribute carrying a draft's language. Its CHOICES are the tenant's. */
export const LANG_FIELD = 'lang';

/** The draft's own headline, addressed like any other segment. */
const NAME_SEGMENT = 'name';

/**
 * Top-level prose fields. `sources` is URLs and everything else is machine state.
 *
 * `story_title` and `angle` were added after measuring the live zh translation
 * (2026-08-24): both were being copied across in English, and `story_title` is
 * the one that SHOWS — `draftTitle()` reads it first and only falls back to
 * `name`, so the drawer's draft list labelled the Chinese piece with its English
 * headline.
 *
 * `topic_title` is deliberately NOT here. It is provenance rather than content:
 * it names the English topic record this draft was written for, and that record
 * keeps its English name. Translating it would leave the draft claiming a topic
 * that does not exist under that title. (It is also not a join key — matching
 * runs on `topic_ref` and the `written_for` edge — so nothing breaks either way;
 * this is a meaning decision, not a safety one.)
 */
const PROSE_FIELDS = ['blog', 'linkedin', 'story_title', 'angle'] as const;

/**
 * The display title, which duplicates `name` on every live draft.
 *
 * When the source has them equal, the translation takes ONE answer for both:
 * two independent translations of one headline drift, and a record that
 * disagrees with itself about its own title is worse than either version.
 */
const TITLE_FIELD = 'story_title';

/** The one prose field nested inside the structured `seo` blob. */
const SEO_PROSE_FIELD = 'meta_description';
const SEO_SEGMENT = `seo.${SEO_PROSE_FIELD}`;

/**
 * Fields the translation must EARN rather than inherit.
 *
 * A judge verdict copied across shows a quality score for text the judge never
 * saw; a copied assignee silently hands someone work they did not take; and
 * `chosen`/`candidate_index` belong to the source's compare-and-pick round.
 * Both key spellings go, because the api client camelCases responses.
 */
const NOT_INHERITED = [
  'judge_verdict',
  'auto_checks',
  'chosen',
  'candidate_index',
  'sent_at',
  'assignee_sub',
  'assignee_name',
];

/**
 * The tenant's `external_id` column width. A key longer than this is refused by
 * the backend, so the key is built to fit rather than hoping.
 */
const EXTERNAL_ID_MAX = 255;

/** Separates the source's key from the locale. Not a slug character, so it can
 *  never be produced by `slugForHeadline` and confused with part of a headline. */
const LOCALE_SEPARATOR = '@';

/**
 * The durable identity of a translation (bd startsim-wn2p.21).
 *
 * WHY THIS EXISTS. Every translation ever written by this app landed with
 * `external_id = ''` — measured live, 2 of 77 drafts, and they are precisely the
 * two translations. The partial unique constraint on the tenant is declared
 * `condition=~Q(external_id="")`, so blank rows are EXEMPT from it: the database
 * accepts unlimited translations of the same draft into the same language, and
 * nothing can address one afterwards to edit or replace it. A record you cannot
 * name is not stored perpetually; it is stored until something makes a rival.
 *
 * WHY IT KEYS OFF THE SOURCE. The obvious key — a slug of the translation's own
 * headline — reproduces the bug exactly. `slugForHeadline` collapses a CJK or
 * Arabic title to '' (see title-durability.ts, which measured it), and '' is the
 * one value the constraint ignores. The source draft is Latin-slugged, so its
 * key plus the target locale is stable, unique, and never blank.
 *
 * WHAT THIS BUYS. Two attempts at the same (source, locale) now produce the SAME
 * key, so the second is refused by the database rather than quietly creating a
 * competing translation. `translatableTargets()` hiding a button stops a careful
 * human; this stops a retried approval, a double-click, and a direct API call —
 * which matters because wn2p.10 turns that button into an automatic trigger.
 */
export function translationExternalId(source: EntityRecord, targetLocale: string): string {
  const locale = targetLocale.trim();
  // A blank locale would produce a key that collides across languages, which is
  // worse than no key at all — so it is refused rather than defaulted.
  if (!locale) {
    throw new Error('translationExternalId: a target locale is required');
  }
  // The source's own key when it has one, else its id. Both live translations
  // have a blank external_id themselves, so the fallback is a real case, not a
  // defensive flourish.
  const base = String(source.externalId ?? '').trim() || String(source.id);
  const suffix = `${LOCALE_SEPARATOR}${locale}`;
  const room = EXTERNAL_ID_MAX - suffix.length;
  // Keep the TAIL of an over-long base: a slug's distinguishing part is at the
  // end (…-for-entrants), so trimming the head keeps two similar sources apart
  // where trimming the tail would silently merge them.
  const head = base.length > room ? base.slice(base.length - room) : base;
  return `${head}${suffix}`;
}

/** The edge that makes a draft a translation OF another draft. */
const TRANSLATION_OF_REL = 'translation_of';

/**
 * The tenant query answering "is there already a translation of this draft into
 * this language?" — path only, so it is asserted without a network.
 *
 * WHY THIS EXISTS ALONGSIDE {@link translationExternalId}. The durable key stops
 * a duplicate from the SAME person and no further. Measured live 2026-08-24: the
 * unique constraint is (org_id, entity_type, external_id, owner_sub), and
 * owner_sub is part of it, so
 *
 *   same owner,      same external_id  ->  400 conflict
 *   different owner, same external_id  ->  201 Created
 *
 * Two reviewers, or one reviewer and an automatic trigger running as somebody
 * else, would each get a translation. The database cannot answer that question;
 * the `translation_of` edge can.
 *
 * `related_direction=out` is named rather than left to the default because the
 * word that reads right is wrong: `in` returns nothing here. The TRANSLATION is
 * the row holding the outgoing edge to its source.
 */
export function existingTranslationQuery(sourceId: string, targetLocale: string): string {
  const params = new URLSearchParams({
    type: 'draft',
    related_to: sourceId,
    related_via: TRANSLATION_OF_REL,
    related_direction: 'out',
    'attr.lang': targetLocale,
    // A yes/no question: the answer is the envelope's `count`, not the rows.
    page_size: '1',
  });
  return `entities?${params.toString()}`;
}

export interface DraftSegment {
  id: string;
  text: string;
}

export interface TranslatedDraft {
  name: string;
  data: Record<string, unknown>;
  /**
   * The durable key. Part of the payload rather than something the route
   * computes on the side, because a translation written WITHOUT one is the
   * defect this whole module exists to close — making it a field of the return
   * type means a caller cannot forget it.
   */
  externalId: string;
}

/** snake_case -> camelCase, matching the tenant client's key transform. */
function toCamelKey(name: string): string {
  return name.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** camelCase-aware read from a data blob — the same trap board.ts already handles. */
function read(bag: Record<string, unknown> | undefined, name: string): unknown {
  if (!bag) return undefined;
  return bag[toCamelKey(name)] ?? bag[name];
}

/** The `seo` blob when it is a plain object, else undefined. */
function seoObject(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const raw = data?.seo;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

/** '' for anything that is not a non-blank string — blank fields are not sent. */
function proseOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().length > 0 ? value : '';
}

/**
 * The prose a translator should see.
 *
 * Everything absent from this list is absent from the PROMPT, which is the
 * cheapest possible guarantee that a URL, a score or an id is never translated.
 */
export function draftSegments(draft: EntityRecord): DraftSegment[] {
  const data = (draft.data ?? {}) as Record<string, unknown>;
  const segments: DraftSegment[] = [];

  const push = (id: string, value: unknown): void => {
    const text = proseOf(value);
    if (text) segments.push({ id, text });
  };

  push(NAME_SEGMENT, draft.name);
  for (const field of PROSE_FIELDS) push(field, read(data, field));
  push(SEO_SEGMENT, read(seoObject(data), SEO_PROSE_FIELD));

  return segments;
}

/**
 * The name + data blob for the NEW draft that carries the translation.
 *
 * A segment the model skipped keeps its SOURCE text rather than being blanked:
 * a partial result is a readable draft with gaps, and writing '' would destroy
 * the very text a reviewer needs in order to fix it.
 */
export function applyDraftTranslations(
  draft: EntityRecord,
  translations: ReadonlyMap<string, string>,
  targetLocale: string,
): TranslatedDraft {
  const source = (draft.data ?? {}) as Record<string, unknown>;
  // Shallow copy plus a fresh `seo`, so the source record is never mutated.
  const data: Record<string, unknown> = { ...source };

  for (const key of NOT_INHERITED) {
    delete data[key];
    delete data[toCamelKey(key)];
  }

  // The source's own title, before anything is written, so the "were they equal"
  // question is asked of the SOURCE rather than of a half-updated copy.
  const sourceTitle = proseOf(read(source, TITLE_FIELD));
  const titleMirrorsName = sourceTitle !== '' && sourceTitle === proseOf(draft.name);

  for (const field of PROSE_FIELDS) {
    const translated =
      field === TITLE_FIELD && titleMirrorsName
        ? translations.get(NAME_SEGMENT) ?? translations.get(field)
        : translations.get(field);
    if (translated === undefined) continue;
    // Write to whichever spelling the source used, so the blob keeps one key.
    if (Object.prototype.hasOwnProperty.call(source, toCamelKey(field))) {
      data[toCamelKey(field)] = translated;
    } else {
      data[field] = translated;
    }
  }

  const seo = seoObject(source);
  const translatedSeo = translations.get(SEO_SEGMENT);
  if (seo) {
    const nextSeo = { ...seo };
    if (translatedSeo !== undefined) {
      const camel = toCamelKey(SEO_PROSE_FIELD);
      if (Object.prototype.hasOwnProperty.call(seo, camel)) nextSeo[camel] = translatedSeo;
      else nextSeo[SEO_PROSE_FIELD] = translatedSeo;
    }
    data.seo = nextSeo;
  }

  data.lang = targetLocale;
  data.status = TRANSLATED_STATUS;

  return {
    name: translations.get(NAME_SEGMENT) ?? draft.name,
    data,
    externalId: translationExternalId(draft, targetLocale),
  };
}

// ---------------------------------------------------------------------------
//  which languages a draft can still be translated INTO (bd startsim-tetf)
// ---------------------------------------------------------------------------

/**
 * The locales this tenant has DECLARED on `draft.lang`.
 *
 * Read from the runtime schema, never from a list in this file. That is what
 * makes adding a language a schema change and nothing else — the reason nothing
 * here names one (`startsim-jb1z`'s naming ban). A tenant that declares
 * `en, ar, zh` offers three; one that declares two offers two.
 */
export function declaredLangChoices(type: EntityTypeDef | null | undefined): string[] {
  const attr = (type?.attributes ?? []).find((a) => a.name === LANG_FIELD);
  const choices = attr?.config?.choices;
  return Array.isArray(choices) ? choices.map((c) => String(c)) : [];
}

/**
 * The targets still worth offering: every declared locale that no draft in this
 * language group already occupies. Offering a language that exists would create
 * a second, competing translation rather than taking the reviewer to the one
 * that is already there.
 */
export function translatableTargets(
  declared: readonly string[],
  presentLangs: readonly string[],
): string[] {
  const taken = new Set(presentLangs.filter(Boolean));
  return declared.filter((choice) => choice && !taken.has(choice));
}
