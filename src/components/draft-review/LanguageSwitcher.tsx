'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notify } from '@startsimpli/ui';

import { getRegisteredToken } from '@/infrastructure/auth';
import { formatBearer } from '@/lib/bearer';
import {
  declaredLangChoices,
  effectiveLocale,
  pendingTranslation,
  translatableTargets,
} from '@/lib/draft-translation';
import { listTypes, type EntityRecord } from '@/lib/foundry-api';
import { DRAFT_TYPE, draftLang, draftTitle, fetchDraftTranslations } from '@/lib/topic-drafts';

/**
 * Language switcher (startsim-ka3j): lists this draft alongside its
 * translations (via lib/topic-drafts.ts's draft<->draft `translation_of`
 * matching), each a link to `/draft/<id>` with its language as the label.
 * No `translation_of` rows exist on the live tenant yet (no translations have
 * been produced), so "No translations yet" is the correct, honest state today
 * — this isn't dead code, it's waiting on real data.
 */
export function LanguageSwitcher({
  draft,
  canEdit = true,
}: {
  draft: EntityRecord;
  /** May the caller edit this draft (its `permissions.canEdit`, bd
   *  startsim-768w.71)? A translation is a NEW draft written into the same
   *  space with the caller's own token, so a view-only reader is not offered
   *  one (bd startsim-whwxd.22); the links to existing languages stay. */
  canEdit?: boolean;
}) {
  const qc = useQueryClient();
  // What the reviewer CLICKED. Whether it has landed is observed from the
  // language group, never mirrored back into this state (see `translating`).
  const [requested, setRequested] = useState<string | null>(null);

  // While a translation is being produced the new draft does not exist yet. The
  // action answers 202 and finishes detached (a 400-500 word brief does not fit
  // in a request — startsim-jb1z measured 19.6s for one document), so the only
  // honest way to show the result is to keep looking for it. Asked of the
  // query's OWN data so polling stops on the arrival itself rather than on a
  // state write; memoised on `requested` so a re-render never restarts the
  // interval.
  const pollUntilTranslated = useCallback(
    (query: { state: { data?: EntityRecord[] } }) =>
      pendingTranslation(requested, (query.state.data ?? []).map((d) => draftLang(d)))
        ? 5_000
        : (false as const),
    [requested],
  );

  const translationsQuery = useQuery({
    queryKey: ['draft-translations', draft.id],
    queryFn: () => fetchDraftTranslations(draft),
    refetchInterval: pollUntilTranslated,
  });
  // The tenant's DECLARED choices, never a list in this file: adding a language
  // is a schema change and no code change (startsim-jb1z's naming ban).
  const typesQuery = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });

  const draftType = (typesQuery.data?.results ?? []).find((t) => t.key === DRAFT_TYPE);
  const declaredLangs = declaredLangChoices(draftType);
  // WHAT A DRAFT THAT NEVER RECORDED ITS LANGUAGE IS IN (bd startsim-s0c4b):
  // the tenant's source locale, which is the first choice its `lang` enum
  // declares. 100 of the 169 live drafts carry no `lang` key, so reading that
  // silence as absence offered "+ EN" on an English brief and labelled it with
  // nothing. Both halves are the same question, so both ask it the same way.
  const localeOf = (d: EntityRecord) => effectiveLocale(draftLang(d), declaredLangs);
  const lang = localeOf(draft);
  const translations = translationsQuery.data ?? [];
  const variants = [draft, ...translations]
    .slice()
    .sort((a, b) => localeOf(a).localeCompare(localeOf(b)));

  const targets = canEdit ? translatableTargets(declaredLangs, variants.map((d) => draftLang(d))) : [];

  // DERIVED, not remembered: we are translating exactly while the language the
  // reviewer asked for is missing from the group. Nothing has to clear it, so
  // there is no state write inside an effect to go wrong (bd startsim-mcoza).
  const translating = pendingTranslation(requested, translations.map((d) => draftLang(d)));
  const arrived = requested !== null && translating === null;

  // Announced once per arrival: `arrived` only flips false->true when a NEW
  // requested language lands, so this cannot repeat on a re-render.
  useEffect(() => {
    if (arrived) notify.success('Translation ready.');
  }, [arrived]);

  async function translateTo(target: string) {
    setRequested(target);
    try {
      // AWAITED. getRegisteredToken() is async, and interpolating it directly
      // sent `Bearer [object Promise]` — Django rejected it and the detached job
      // died on its first tenant call, while this button still reported success
      // because the 202 comes back before the job runs.
      const res = await fetch('/actions/translate-draft', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The handler forwards THIS bearer to the tenant API, so the
          // translation is written with the clicker's own rights.
          authorization: formatBearer(await getRegisteredToken()),
        },
        body: JSON.stringify({ draftId: draft.id, targetLocale: target }),
      });
      if (!res.ok) throw new Error(`Translation request failed (${res.status}).`);
      notify.success(`Translating to ${target.toUpperCase()} — this takes about a minute.`);
      void qc.invalidateQueries({ queryKey: ['draft-translations', draft.id] });
    } catch (err) {
      setRequested(null);
      notify.error(err instanceof Error ? err.message : 'Could not start the translation.');
    }
  }

  if (translationsQuery.isLoading) return null;

  return (
    <div className="flex items-center gap-1">
      {variants.length > 1 ? (
        variants.map((d) => (
          <Link
            key={String(d.id)}
            href={`/draft/${d.id}`}
            title={draftTitle(d)}
            className={`rounded-full border px-2 py-0.5 text-xs uppercase ${
              d.id === draft.id
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            {localeOf(d) || '—'}
          </Link>
        ))
      ) : (
        <span className="text-xs text-neutral-400">
          {lang ? `${lang.toUpperCase()} · ` : ''}No translations yet.
        </span>
      )}

      {/* One button per language still missing. It disappears when every
          declared language exists, rather than creating a competing copy. */}
      {targets.map((target) => (
        <button
          key={target}
          type="button"
          disabled={translating !== null}
          onClick={() => void translateTo(target)}
          title={`Translate this draft into ${target.toUpperCase()}`}
          className="rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-xs uppercase text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"
        >
          {translating === target ? `${target}…` : `+ ${target}`}
        </button>
      ))}
    </div>
  );
}
