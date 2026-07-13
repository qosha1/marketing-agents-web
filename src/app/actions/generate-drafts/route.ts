/**
 * "Generate drafts" trigger (bd 768w.16.9.4).
 *
 * Server-side POST handler that forwards a topic's story to the n8n writer
 * webhook. The webhook URL lives ONLY on the server (`N8N_WRITER_WEBHOOK_URL`,
 * with a hardcoded fallback) — never shipped to the browser — so the client just
 * POSTs `{ story }` here and we relay it. The webhook is fire-and-forget: it
 * returns 200 immediately and the writer runs async, writing candidate `draft`
 * records back to the tenant (each stamped with `topic_ref`). We return 202 on a
 * 2xx from the webhook, 502 otherwise.
 *
 * PATH NOTE: this handler lives at /actions/* NOT /api/* on purpose. In a deployed
 * tenant, nginx routes every /api/* request to the Django backend (which has no
 * such route → 404) before Next ever sees it; only non-/api paths reach the Next
 * frontend. So this server action must sit outside /api. (Locally, where Next
 * serves everything, /api would have worked — hence the earlier 404 in prod.)
 */
import { NextResponse } from 'next/server';

const DEFAULT_WEBHOOK_URL =
  'https://debugg.app.n8n.cloud/webhook/ogmc-generate-drafts-7h3k9x2q';

export async function POST(request: Request) {
  const webhookUrl = process.env.N8N_WRITER_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

  let story: unknown;
  try {
    const body = (await request.json()) as { story?: unknown };
    story = body?.story;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!story || typeof story !== 'object') {
    return NextResponse.json({ error: 'Missing story.' }, { status: 400 });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(story),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Writer webhook responded ${res.status}.` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the writer webhook.' },
      { status: 502 },
    );
  }
}
