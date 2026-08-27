/**
 * The server-side "Generate drafts" gate (bd startsim-ozpjw.2).
 *
 * startsim-0e9ue closed the BUTTON. It did not close the behaviour: this route
 * validated only that the body carried a `story` object and then relayed it to
 * the n8n writer, so any authenticated tab could POST a story for a topic in
 * any state. Measured on the live tenant, 12 drafts sit against topics still on
 * `suggested` — one of them generated in front of the customer on 2026-08-25.
 *
 * WHAT THESE TESTS ASSERT, and why it is phrased this way: the refusal must
 * happen BEFORE the webhook is called. A 200 with the write suppressed
 * somewhere downstream is a different guarantee — the writer would already have
 * been paid for and the drafts would already exist. So every refusal case
 * asserts `global.fetch` was never called, not merely that the status was 4xx.
 *
 * `global.fetch` IS STUBBED IN `beforeEach` AND THAT IS NOT OPTIONAL. The route
 * POSTs to a real, uncredentialed production webhook
 * (`ogmc-generate-drafts-7h3k9x2q`); an unstubbed run of this file would fire
 * the live writer and create real drafts in the customer's tenant.
 *
 * THE SCHEMA FIXTURES ARE RAW snake_case ON PURPOSE. `tenantFetch` returns
 * Django's JSON untouched — the shared browser client's snake→camel transform
 * is not in play server-side — so the type arrives as `data_type: 'enum'`.
 * `resolveReviewConfig`'s `pickStatusAttr` filters on `a.dataType === 'enum'`,
 * so a route that forwards the raw shape resolves `transitions.approve: null`
 * and refuses EVERY topic, approved ones included. A camelCase fixture would
 * pass here while production quietly lost the button, so the wire shape is the
 * thing under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tenant-fetch', () => ({ tenantFetch: vi.fn() }));

import { tenantFetch } from '@/lib/tenant-fetch';
import { POST } from '../route';

const TOPIC_ID = 4242;
const AUTH = 'Bearer test.token.value';

/** The topic type as DJANGO sends it — snake_case, not the client's camelCase. */
const TOPIC_TYPE_WIRE = {
  id: 'type-1',
  key: 'topic',
  label: 'Topic',
  attributes: [
    {
      id: 'attr-1',
      name: 'status',
      data_type: 'enum',
      required: false,
      config: { choices: ['suggested', 'ready', 'written', 'rejected'] },
    },
  ],
};

/** A topic record as Django sends it. */
function topicWire(status: string, id: number = TOPIC_ID) {
  return { id, entity_type: 'topic', external_id: `topic-${id}`, name: 'A Topic', data: { status } };
}

/** A draft record as Django sends it. */
function draftWire(id: number, topicRef: string | number) {
  return {
    id,
    entity_type: 'draft',
    external_id: `draft-${id}`,
    name: 'A Draft',
    data: { topic_ref: String(topicRef) },
  };
}

/** Route the mocked tenant reads by path, the way the real backend would. */
function stubTenant(opts: {
  topic?: unknown;
  types?: unknown[];
  drafts?: unknown[];
  draftsNext?: string | null;
  fail?: boolean;
}) {
  vi.mocked(tenantFetch).mockImplementation(async (path: string) => {
    if (opts.fail) throw new Error(`tenant GET ${path} is unreachable`);
    if (path.startsWith('schema/types')) {
      return { count: 1, next: null, previous: null, results: opts.types ?? [TOPIC_TYPE_WIRE] };
    }
    if (path.startsWith('entities?')) {
      const drafts = opts.drafts ?? [];
      return {
        count: drafts.length,
        next: opts.draftsNext ?? null,
        previous: null,
        results: drafts,
      };
    }
    if (path.startsWith('entities/')) {
      if (opts.topic === null) throw new Error(`tenant GET ${path} responded 404`);
      return opts.topic ?? topicWire('ready');
    }
    throw new Error(`unexpected tenant path: ${path}`);
  });
}

/** A story exactly as `buildStoryFromTopic` produces it. `null` omits topic_ref
 *  (NOT `undefined` — that hits the default parameter and keeps the key). */
function story(topicRef: string | number | null = TOPIC_ID) {
  return {
    title: 'A Topic',
    market: 'UAE',
    context: 'why it matters',
    sources: 'https://example.com',
    content_type: 'weekly_brief',
    ...(topicRef === null ? {} : { topic_ref: String(topicRef) }),
    topic_title: 'A Topic',
  };
}

function post(body: unknown, auth: string | null = AUTH): Request {
  return new Request('http://localhost/actions/generate-drafts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // See the file header: without this the route POSTs the LIVE writer webhook.
  global.fetch = vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
});

describe('POST /actions/generate-drafts', () => {
  it('refuses an unapproved topic BEFORE the writer webhook is called', async () => {
    // The Aug-25 hole, at the seam the button could not close.
    stubTenant({ topic: topicWire('suggested') });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
    const body = (await res.json()) as { reason?: string; error?: string };
    expect(body.reason).toBe('not_approved');
  });

  it('refuses a rejected topic, and a topic with no status at all', async () => {
    stubTenant({ topic: topicWire('rejected') });
    expect((await POST(post({ story: story() }))).status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();

    stubTenant({ topic: { ...topicWire('ready'), data: {} } });
    expect((await POST(post({ story: story() }))).status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses a topic whose drafts already exist — no silent 4th candidate', async () => {
    stubTenant({
      topic: topicWire('ready'),
      drafts: [draftWire(1, TOPIC_ID), draftWire(2, TOPIC_ID), draftWire(3, TOPIC_ID)],
    });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(((await res.json()) as { reason?: string }).reason).toBe('drafts_exist');
  });

  it('relays an approved topic with no drafts — reading the RAW snake_case schema', async () => {
    // The hazard this fixture exists for: forwarding `data_type` unchanged into
    // resolveReviewConfig resolves approve: null and refuses this, killing the
    // button for everyone. Approved must still mean approved.
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ topic_ref: String(TOPIC_ID) });
  });

  it('counts only THIS topic’s drafts when the tenant ignores the attr filter', async () => {
    // Measured caveat (foundry-api.ts): the deployed tenant SILENTLY IGNORES an
    // unrecognised query parameter, so a dropped `attr.topic_ref` returns every
    // draft rather than an error. Trusting the envelope `count` would then
    // refuse every topic as drafts_exist. The rows are re-checked in JS, so an
    // ignored filter degrades to the poll's own approach instead of a dead button.
    stubTenant({
      topic: topicWire('ready'),
      drafts: [draftWire(1, 999), draftWire(2, 1000), draftWire(3, 1001)],
    });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a story with no topic_ref — a draft nothing can gate by construction', async () => {
    // 38 live drafts carry no topic_ref (startsim-li19's legacy). A draft with
    // no topic reference cannot be gated by topic status ever, so the payload
    // that would create another one is refused outright.
    stubTenant({ topic: topicWire('ready') });

    const res = await POST(post({ story: story(null) }));

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated call rather than relaying it unchecked', async () => {
    stubTenant({ topic: topicWire('ready') });

    const res = await POST(post({ story: story() }, null));

    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the topic cannot be verified', async () => {
    // "Could not check" is not "allowed". Failing open here would reinstate the
    // exact hole this route exists to close, on the one day the tenant blips.
    stubTenant({ fail: true });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(502);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still rejects a body with no story at all', async () => {
    stubTenant({ topic: topicWire('ready') });
    expect((await POST(post({}))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
