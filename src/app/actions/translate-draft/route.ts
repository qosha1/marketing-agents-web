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

import { applyDraftTranslations, draftSegments } from '@/lib/draft-translation';
import { tenantApiBase, translationEnv } from '@/lib/translation-config';
import type { EntityRecord } from '@/lib/foundry-api';

export const dynamic = 'force-dynamic';

const DRAFT_TYPE = 'draft';
const TRANSLATION_OF = 'translation_of';

/**
 * Server-side base for the tenant backend. NOT `DJANGO_API_URL` — that is set
 * only locally, so in a deployed tenant this handler would have pointed at
 * itself. See `translation-config.ts`; the deployed answer is the Cloud Map
 * FQDN nginx already proxies to.
 */
function tenantBase(): string {
  return tenantApiBase(process.env as Record<string, string | undefined>);
}

/**
 * Direct server-side tenant call.
 *
 * Deliberately NOT the shared browser client: that one reads a token from the
 * browser and redirects to signin on 401, neither of which means anything here.
 * The trailing slash is mandatory — without it DRF 301s a POST into a GET and
 * the write silently vanishes (the recorded tenant-nginx failure).
 */
async function tenantFetch<T>(
  path: string,
  auth: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${tenantBase()}/api/v1/${path}/`, {
    method: init.method,
    headers: {
      authorization: auth,
      'content-type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  if (!res.ok) {
    // Status and path only. The body can carry the draft's own text, and a
    // translation product that logs client material has no wall to sell.
    throw new Error(`tenant ${init.method} ${path} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

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
  const created = await tenantFetch<EntityRecord>('entities', auth, {
    method: 'POST',
    body: { entity_type: DRAFT_TYPE, name: next.name, data: next.data },
  });

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
      // Name only — never the message, which can quote the draft.
      console.error('[translate-draft] job failed', {
        draftId,
        error: (error as Error).name,
      });
    },
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
