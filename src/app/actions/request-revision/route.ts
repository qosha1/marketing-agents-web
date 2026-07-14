/**
 * "Request revision" trigger (bd 768w.16.10.5).
 *
 * Server-side POST handler that forwards a reviewer's critique to the n8n revise
 * webhook, which GPT-rewrites the draft into a NEW candidate version (stamped with
 * `revised_from = <parent draft id>`) written back to the tenant. The webhook URL
 * lives ONLY on the server (`N8N_REVISE_WEBHOOK_URL`, with a hardcoded fallback) —
 * never shipped to the browser — so the client POSTs the payload here and we relay
 * it. Fire-and-forget: the webhook returns 200 immediately and the rewriter runs
 * async. We return 202 on a 2xx from the webhook, 502 otherwise.
 *
 * PATH NOTE: like /actions/generate-drafts, this handler lives at /actions/* NOT
 * /api/* on purpose — in a deployed tenant nginx routes every /api/* request to the
 * Django backend (404 there) before Next sees it; only non-/api paths reach Next.
 */
import { NextResponse } from 'next/server';

const DEFAULT_WEBHOOK_URL =
  'https://debugg.app.n8n.cloud/webhook/ogmc-revise-draft-9k2m4x';

export async function POST(request: Request) {
  const webhookUrl = process.env.N8N_REVISE_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Missing revision payload.' }, { status: 400 });
  }
  if (!payload.parent_draft_id) {
    return NextResponse.json({ error: 'Missing parent_draft_id.' }, { status: 400 });
  }
  if (!String(payload.feedback ?? '').trim()) {
    return NextResponse.json({ error: 'Missing feedback.' }, { status: 400 });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Revise webhook responded ${res.status}.` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the revise webhook.' },
      { status: 502 },
    );
  }
}
