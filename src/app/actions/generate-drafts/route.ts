/**
 * "Generate drafts" trigger (bd 768w.16.9.4, gated server-side by startsim-ozpjw.2).
 *
 * Server-side POST handler that forwards a topic's story to the n8n writer
 * webhook. The webhook URL lives ONLY on the server (`N8N_WRITER_WEBHOOK_URL`,
 * with a hardcoded fallback) — never shipped to the browser — so the client just
 * POSTs `{ story }` here and we relay it. The webhook is fire-and-forget: it
 * returns 200 immediately and the writer runs async, writing candidate `draft`
 * records back to the tenant (each stamped with `topic_ref`). We return 202 on a
 * 2xx from the webhook, 502 otherwise.
 *
 * THE GATE, and why it is HERE (bd startsim-ozpjw.2). startsim-0e9ue gated the
 * drawer's CONTROL: an unapproved topic renders a reason instead of a button.
 * That closed the button, not the behaviour — this route checked only that the
 * body carried a `story` object, so any authenticated tab could POST a story for
 * a topic in any state and the writer would run. Measured on the live tenant, 12
 * drafts sit against topics still on `suggested`, one of them generated in front
 * of the customer on 2026-08-25.
 *
 * The re-check calls `canGenerateDrafts` — the SAME predicate the drawer calls,
 * over the SAME `resolveReviewConfig` map the Approve button derives from. There
 * is no second definition of "approved" anywhere in this file; see
 * `topic-gate.ts` for how the three inputs are read out of the tenant.
 *
 * WHAT THIS DOES NOT CLAIM. It makes the APP refuse to generate drafts from an
 * unapproved topic. It is not a claim that nothing can: the n8n webhook it
 * relays to accepts unauthenticated POSTs, so the durable seam for the invariant
 * is the tenant backend refusing to create a draft for an unapproved topic.
 *
 * The SCHEDULED path needs no equivalent change: `OGMC — Auto-write Ready Topics
 * (poll)` selects `status === 'ready'` topics with no draft carrying their
 * `topic_ref`, which is both arms of this same gate.
 *
 * WHO PRESSED IT (bd startsim-8hgmq.7). The relay names its caller. The webhook
 * forwards `trigger` (defaulting to `generate_button`) and `triggered_by`
 * verbatim into the writer, which stamps them as `data._trigger` /
 * `data._triggered_by` — the fields `lib/draft-origin.ts` renders in the
 * "Created by" column, and the difference between a draft that says "AI writer"
 * and one that says who asked for it.
 *
 * THE IDENTITY IS THE CALLER'S EMAIL, and the reason is not really a preference.
 * `whoami` returns `{sub, email, companyId, orgId, role}` — there is no display
 * name to choose, so the choice is email or `sub`, and `sub`
 * (`1c44a170-eee3-…`) answers "who pressed this?" with a string no reader can
 * resolve, which is the whole question the column exists for. The email stays
 * inside the tenant that produced it, shown to signed-in members of the same
 * company who already see each other's addresses in the roster. n8n is
 * format-agnostic (it forwards whatever string it is given), so this is one
 * line to change if the customer ever wants it shortened.
 *
 * RESOLVING THE CALLER IS NEVER A REASON TO REFUSE. Unlike the gate — where
 * "could not check" is deliberately a 502, because failing open reinstates the
 * hole — an unknown presser is a missing nicety. The whoami read has its OWN
 * try/catch for exactly that reason: inside the gate's, a whoami blip would
 * surface as "Could not verify the topic" and cost the customer their button
 * over a label. An unresolved caller omits the key, matching the writer, which
 * omits `_triggered_by` when it is empty so absence reads as "not known" rather
 * than as a person with a blank name.
 *
 * ONE WRITER PER TOPIC AT A TIME (bd startsim-8hgmq.8). The gate above cannot
 * refuse a second press inside the writer's ~100s latency, because the drafts it
 * counts do not exist yet. `lib/generate-claim.ts` holds the in-flight claim —
 * read its header for why a TTL lock is safe here and what it deliberately does
 * not promise. A press that loses the claim is answered 202 `deduped: true`
 * rather than a 4xx: a run for that topic IS under way and its drafts are on the
 * way, so the honest answer is "accepted", and a refusal would make the drawer
 * throw, end its own run and stop polling for drafts that are about to land.
 *
 * PATH NOTE: this handler lives at /actions/* NOT /api/* on purpose. In a deployed
 * tenant, nginx routes every /api/* request to the Django backend (which has no
 * such route → 404) before Next ever sees it; only non-/api paths reach the Next
 * frontend. So this server action must sit outside /api. (Locally, where Next
 * serves everything, /api would have worked — hence the earlier 404 in prod.)
 */
import { NextResponse } from 'next/server';

import { claimGenerateRun, releaseGenerateClaim } from '@/lib/generate-claim';
import { tenantFetch } from '@/lib/tenant-fetch';
import { resolveTopicGate } from '@/lib/topic-gate';

export const dynamic = 'force-dynamic';

const DEFAULT_WEBHOOK_URL =
  'https://debugg.app.n8n.cloud/webhook/ogmc-generate-drafts-7h3k9x2q';

/**
 * Name the person behind this bearer, or nobody.
 *
 * NEVER THROWS, by construction: every caller of this is one line away from the
 * relay, and a label is not worth a refusal. `tenantFetch` returns Django's raw
 * JSON (no snake→camel transform server-side), but `email` is casing-neutral —
 * the field that would have needed care, `company_id`, is not read here.
 */
async function resolveCaller(auth: string): Promise<string | undefined> {
  try {
    const me = await tenantFetch<{ email?: unknown }>('whoami', auth, { method: 'GET' });
    const email = typeof me?.email === 'string' ? me.email.trim() : '';
    return email || undefined;
  } catch (error) {
    // Logged, not raised: the draft is still worth writing unattributed, and a
    // silent omission would look identical to a caller who has no email.
    console.warn('[generate-drafts] could not resolve the caller', {
      detail: (error as Error).message,
    });
    return undefined;
  }
}

export async function POST(request: Request) {
  const webhookUrl = process.env.N8N_WRITER_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

  // The gate is a tenant READ, and this handler has no session of its own, so it
  // borrows the caller's — the same shape /actions/translate-draft uses. A call
  // with no bearer cannot be checked, and an unchecked call is the thing this
  // route exists to stop, so it is refused rather than relayed.
  const auth = request.headers.get('authorization');
  if (!auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let story: Record<string, unknown> | undefined;
  try {
    const body = (await request.json()) as { story?: unknown };
    const candidate = body?.story;
    story = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!story) {
    return NextResponse.json({ error: 'Missing story.' }, { status: 400 });
  }

  // A draft with no topic reference cannot be gated by topic status by
  // construction — 38 such rows are already live (startsim-li19's legacy) and
  // nothing can retro-fit their approval. So a story with no topic_ref is
  // refused outright rather than written and reasoned about later.
  const topicRef = String(story.topic_ref ?? '').trim();
  if (!topicRef) {
    return NextResponse.json({ error: 'Missing topic_ref.' }, { status: 400 });
  }

  let gate;
  try {
    gate = await resolveTopicGate(
      <T,>(path: string) => tenantFetch<T>(path, auth, { method: 'GET' }),
      topicRef,
    );
  } catch (error) {
    // "Could not check" is NOT "allowed". Failing open here would reinstate the
    // hole on the one day the tenant blips, so an unverifiable topic is a 502.
    console.error('[generate-drafts] could not verify the topic', {
      topicRef,
      detail: (error as Error).message,
    });
    return NextResponse.json({ error: 'Could not verify the topic.' }, { status: 502 });
  }

  if (!gate.allowed) {
    // The reason travels with the refusal: the drawer already renders one, and a
    // 403 with no explanation is the same confusion in a different shape.
    return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: 403 });
  }

  // AFTER the gate, never before: once the drafts have landed, "this topic
  // already has drafts" is the truer answer and must not be masked by "a run is
  // in flight". Claimed BEFORE the relay, so two presses race the same entry
  // rather than each other's copy of a boolean.
  const claim = claimGenerateRun(topicRef, Date.now());
  if (!claim.claimed) {
    // Logged so the mechanism is measurable — an invisible dedupe cannot be told
    // apart from a button that quietly did nothing.
    console.warn('[generate-drafts] a writer is already in flight for this topic', {
      topicRef,
      heldForMs: claim.heldForMs,
      expiresInMs: claim.expiresInMs,
    });
    return NextResponse.json({ ok: true, deduped: true }, { status: 202 });
  }

  const triggeredBy = await resolveCaller(auth);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...story,
        // Explicit, though the webhook defaults to it: the caller that knows it
        // is a button press should say so, and a default is a place a future
        // caller can be silently wrong about.
        trigger: 'generate_button',
        ...(triggeredBy ? { triggered_by: triggeredBy } : {}),
      }),
    });
    if (!res.ok) {
      // The writer never started, so nothing is in flight to protect.
      releaseGenerateClaim(topicRef);
      return NextResponse.json(
        { error: `Writer webhook responded ${res.status}.` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, deduped: false }, { status: 202 });
  } catch {
    releaseGenerateClaim(topicRef);
    return NextResponse.json(
      { error: 'Could not reach the writer webhook.' },
      { status: 502 },
    );
  }
}
