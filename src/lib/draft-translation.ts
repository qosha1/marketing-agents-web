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

/** Top-level prose fields. `sources` is URLs and everything else is machine state. */
const PROSE_FIELDS = ['blog', 'linkedin'] as const;

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

export interface DraftSegment {
  id: string;
  text: string;
}

export interface TranslatedDraft {
  name: string;
  data: Record<string, unknown>;
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

  for (const field of PROSE_FIELDS) {
    const translated = translations.get(field);
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
