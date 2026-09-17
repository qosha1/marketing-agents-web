/**
 * The "Request revision" relay (bd startsim-0r7ru).
 *
 * `global.fetch` IS STUBBED IN `beforeEach` AND THAT IS NOT OPTIONAL. This route
 * POSTs a real, uncredentialed production webhook
 * (`ogmc-revise-draft-9k2m4x`); an unstubbed run of this file would fire the
 * live reviser and write a real draft into a paying customer's tenant. Do not
 * remove the stub, and do not add a test that runs before it.
 *
 * WHAT IS UNDER TEST HERE IS THE *RELAY*, not a new decision. The scope fix for
 * startsim-0r7ru is deliberately NOT in this file: the payload is assembled by
 * the page (see `lib/revision-request.ts`) and this handler forwards whatever it
 * is given. That is worth pinning down rather than assuming, because it is the
 * assumption the whole chain rests on — the reviser reads `$json.body.scope_path`
 * off the webhook body, so a handler that rebuilt the payload from a field list
 * (the obvious "tidy-up") would silently drop the new key and put the bug back
 * with every test above it still green.
 *
 * The 202 is the OTHER half of why this was invisible for two weeks: the webhook
 * answers "Workflow got started" before the reviser has done anything, so a
 * revision that the tenant went on to refuse still reported success here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const BODY = {
  topic_ref: '4242',
  content_type: 'weekly_brief',
  market: 'UAE',
  feedback: 'Tighten the opening.',
  blog: '## A heading',
  linkedin: 'A post.',
  sources: 'Arab News (2026-07-13) https://example.com',
  parent_draft_id: '77',
};

function post(body: unknown): Request {
  return new Request('http://localhost/actions/request-revision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The body the route actually put on the wire. */
function relayed(): Record<string, unknown> {
  const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // See the file header: without this the route POSTs the LIVE reviser webhook.
  global.fetch = vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
});

describe('POST /actions/request-revision', () => {
  it('relays the scope path verbatim, so the reviser can stamp the new draft', async () => {
    const res = await POST(post({ ...BODY, scope_path: '/ogmc-agent-test' }));

    expect(res.status).toBe(202);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(relayed().scope_path).toBe('/ogmc-agent-test');
  });

  it('relays the payload UNCHANGED — it is not a field list to be kept in step', async () => {
    await POST(post({ ...BODY, scope_path: '/ogmc' }));

    expect(relayed()).toEqual({ ...BODY, scope_path: '/ogmc' });
  });

  it('forwards the absence of a scope as an absence, not as an empty string', async () => {
    // The reviser omits `scope_path` from the draft it builds when the key is
    // missing OR blank — but the app must not be the thing that invents `''`.
    await POST(post(BODY));

    expect(relayed()).toEqual(BODY);
    expect('scope_path' in relayed()).toBe(false);
  });

  it('refuses a payload with no parent draft or no feedback before calling the webhook', async () => {
    const noParent: Record<string, unknown> = { ...BODY };
    delete noParent.parent_draft_id;
    expect((await POST(post(noParent))).status).toBe(400);
    expect((await POST(post({ ...BODY, feedback: '   ' }))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('answers 502 when the webhook refuses, rather than reporting a revision', async () => {
    global.fetch = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;

    expect((await POST(post(BODY))).status).toBe(502);
  });
});
