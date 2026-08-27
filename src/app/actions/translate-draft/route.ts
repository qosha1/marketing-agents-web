/**
 * "Translate" trigger (bd startsim-bxkd).
 *
 * Replaces the n8n workflow this action was originally designed as. Translation
 * is a SHARED capability in `@startsimpli/llm/translation` (decision
 * `startsim-jb1z`), not a per-tenant workflow — three products want it, and an
 * OGMC-only n8n build guarantees three forks.
 *
 * SHAPE, and why it is this shape:
 *
 *  - FIRE AND FORGET, 202. `startsim-jb1z` records a measured fact: one document
 *    of 3,101 prompt chars takes 19.6s and two do not finish inside the provider
 *    client's own 60s timeout. A draft is a 400–500 word brief plus a LinkedIn
 *    post plus meta description, so awaiting it inside the request is how you
 *    get a gateway timeout. This app is deployed as a long-running container
 *    (Dockerfile, tenant ECS service — not serverless), so work detached after
 *    the response actually finishes. Same contract "Generate drafts" already
 *    uses, which n8n was absorbing for it.
 *
 *  - THE CALLER'S BEARER IS FORWARDED. The shared api client attaches central
 *    auth in the BROWSER; a server handler has no session of its own. Rather
 *    than mint a service token with standing write access to every draft, the
 *    handler borrows the caller's own rights for this one job — it can write
 *    exactly what the person who clicked could have written.
 *
 *  - THE LLM KEY NEVER LEAVES THE SERVER, which is the whole reason this is a
 *    route handler and not a client-side call.
 *
 * PATH NOTE: /actions/* NOT /api/*. In a deployed tenant, nginx routes every
 * /api/* request to Django before Next sees it, so a handler under /api is
 * unreachable in prod (see generate-drafts/route.ts for the same note).
 */
import { NextResponse } from 'next/server';

import { createAnthropicProvider, createOpenAIProvider, type ILLMProvider } from '@startsimpli/llm';
import {
  createTranslationService,
  resolveTranslationRoute,
  type TranslationRoute,
} from '@startsimpli/llm/translation';

import {
  applyDraftTranslations,
  draftSegments,
  existingTranslationQuery,
} from '@/lib/draft-translation';
import { tenantFetch } from '@/lib/tenant-fetch';
import { translationEnv } from '@/lib/translation-config';
import type { EntityRecord } from '@/lib/foundry-api';

export const dynamic = 'force-dynamic';

const DRAFT_TYPE = 'draft';
const TRANSLATION_OF = 'translation_of';

/** The configured provider, by name. Returns null when the deployment has no key. */
function providerFor(name: string): ILLMProvider | null {
  if (name === 'openai') return createOpenAIProvider();
  return createAnthropicProvider();
}

/**
 * The actual job. Runs AFTER the response has gone out, so every exit is a log
 * line rather than a status code — the caller learns the outcome by the new
 * draft appearing in the language switcher, or not.
 */
async function runTranslation(
  route: TranslationRoute,
  provider: ILLMProvider,
  auth: string,
  draftId: string | number,
  targetLocale: string,
): Promise<void> {
  const draft = await tenantFetch<EntityRecord>(`entities/${draftId}`, auth, { method: 'GET' });

  // BEFORE the model, not after. The durable external_id refuses a duplicate from
  // the same person, but the unique constraint includes `owner_sub` — measured:
  // a different owner posting the same external_id gets 201, not 400 — so two
  // reviewers, or a reviewer and an automatic trigger running as somebody else,
  // would each get a translation. This asks the edge instead, which has no owner
  // dimension. It is also where the money is: without it a duplicate press pays
  // for a full translation and then throws it away.
  const existing = await tenantFetch<{ count?: number }>(
    existingTranslationQuery(String(draft.id), targetLocale),
    auth,
    { method: 'GET' },
  );
  if ((existing?.count ?? 0) > 0) {
    console.info('[translate-draft] a translation already exists — not making a second', {
      draftId,
      targetLocale,
    });
    return;
  }

  const segments = draftSegments(draft);
  if (segments.length === 0) {
    console.warn('[translate-draft] nothing to translate', { draftId });
    return;
  }

  const sourceLocale = String((draft.data as Record<string, unknown>)?.lang ?? '') || 'en';
  const service = createTranslationService(route, { provider });

  // No glossary and no memory: those stores are L2 (startsim-466j) and are
  // declared-not-implemented by design. Passing empty is honest, not a stub.
  const result = await service.translate({ segments, sourceLocale, targetLocale });

  const translations = new Map(result.translated.map((unit) => [unit.id, unit.targetText]));
  if (translations.size === 0) {
    console.error('[translate-draft] provider returned nothing usable', {
      draftId,
      failed: result.failed.length,
      providerCalls: result.providerCalls,
    });
    return;
  }

  const next = applyDraftTranslations(draft, translations, targetLocale);

  // external_id is what makes this record findable forever, and what makes a
  // SECOND translation of the same draft into the same language a 400 from the
  // database rather than a rival row nothing can tell apart (bd wn2p.21). The
  // create endpoint is deliberate: a translation is written once and then
  // belongs to its reviewer. Re-translating has to be an explicit act, not a
  // silent overwrite of someone's edits — which is exactly what pointing this at
  // /entities/upsert/ would buy, since upsert merges `data` but assigns `name`
  // outright (measured in title-durability.ts).
  const created = await tenantFetch<EntityRecord>('entities', auth, {
    method: 'POST',
    body: {
      entity_type: DRAFT_TYPE,
      external_id: next.externalId,
      name: next.name,
      data: next.data,
    },
  }).catch((error: unknown) => {
    // A conflict here is the guard WORKING. Say so plainly rather than logging
    // it as a failure: the reviewer already has a translation in this language,
    // and the app should send them to it rather than make them a second one.
    const detail = (error as Error).message;
    if (detail.includes('409') || detail.includes('400')) {
      console.info('[translate-draft] a translation already exists', {
        draftId,
        targetLocale,
        externalId: next.externalId,
      });
      return null;
    }
    throw error;
  });
  if (!created) return;

  // The edge is what makes the pair a language GROUP rather than two unrelated
  // drafts: source = the translation, target = the original (topic-drafts.ts's
  // originalOfTranslation follows it outgoing).
  await tenantFetch('relationships', auth, {
    method: 'POST',
    body: { rel_type: TRANSLATION_OF, source: created.id, target: draft.id },
  });

  console.info('[translate-draft] created translation', {
    draftId,
    createdId: created.id,
    targetLocale,
    segments: segments.length,
    translated: result.translated.length,
    failed: result.failed.length,
    providerCalls: result.providerCalls,
  });
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization');
  if (!auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let draftId: unknown;
  let targetLocale: unknown;
  try {
    const body = (await request.json()) as { draftId?: unknown; targetLocale?: unknown };
    draftId = body?.draftId;
    targetLocale = body?.targetLocale;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (draftId == null || (typeof draftId !== 'string' && typeof draftId !== 'number')) {
    return NextResponse.json({ error: 'Missing draftId.' }, { status: 400 });
  }
  // The locale is DATA — validated as a non-blank string here and against the
  // tenant's declared `lang` choices by the backend on write. Nothing in this
  // app names a language (startsim-jb1z's naming ban), so adding `zh` for the
  // WeChat channel is a schema change and no code change at all.
  if (typeof targetLocale !== 'string' || targetLocale.trim().length === 0) {
    return NextResponse.json({ error: 'Missing targetLocale.' }, { status: 400 });
  }

  // Boot-shaped failures answer NOW rather than dying invisibly in the detached
  // job: a misconfigured deployment is a 500 the clicker can see.
  let route: TranslationRoute;
  try {
    route = resolveTranslationRoute(translationEnv(process.env as Record<string, string | undefined>));
  } catch (error) {
    console.error('[translate-draft] translation route is misconfigured', {
      reason: (error as Error).name,
    });
    return NextResponse.json({ error: 'Translation is not configured.' }, { status: 500 });
  }

  const provider = providerFor(route.provider);
  if (!provider || !provider.isAvailable()) {
    console.error('[translate-draft] provider unavailable', { provider: route.provider });
    return NextResponse.json({ error: 'Translation provider unavailable.' }, { status: 503 });
  }

  void runTranslation(route, provider, auth, draftId, targetLocale.trim()).catch(
    (error: unknown) => {
      // Every Error this file constructs carries only a method, a path and a
      // status — never a body — so the message is safe to log and is the only
      // thing that makes a failed job diagnosable. The first live failure logged
      // just the NAME ('Error') and cost a deploy cycle to identify.
      console.error('[translate-draft] job failed', {
        draftId,
        error: (error as Error).name,
        detail: (error as Error).message,
      });
    },
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
