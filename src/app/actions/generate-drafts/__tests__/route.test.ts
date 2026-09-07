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
 *
 * `stubTenant` ANSWERS `whoami` FOR THE SAME REASON (bd startsim-8hgmq.7). The
 * route now resolves the caller from the bearer it already holds, and that read
 * is deliberately non-fatal — a whoami blip omits the label rather than
 * refusing the generate. So a stub that threw `unexpected tenant path` on
 * `whoami` would be SWALLOWED: every test here would stay green while
 * `triggered_by` was silently dropped in production, which is the exact class
 * of bug the paragraph above describes. The happy path therefore asserts the
 * relayed body CARRIES the caller, positively, and a separate test breaks only
 * the whoami read to prove the relay still happens without it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tenant-fetch', () => ({ tenantFetch: vi.fn() }));

import { resetGenerateClaims } from '@/lib/generate-claim';
import { tenantFetch } from '@/lib/tenant-fetch';
import { POST } from '../route';

const TOPIC_ID = 4242;
const AUTH = 'Bearer test.token.value';
/** The reviewer whose bearer this is, as the tenant's own whoami reports her. */
const CALLER_EMAIL = 'qa-marketing-agents@startsimpli.com';
const CALLER_SUB = '1c44a170-eee3-4922-b38b-36dbe76e7ee5';

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

/**
 * Route the mocked tenant reads by path, the way the real backend would.
 *
 * `attrFilter` IS THE POINT OF THIS HELPER, not a knob (bd startsim-8hgmq.3).
 * It used to answer every `entities?` path with the fixture rows, which quietly
 * assumed any filter in the URL had worked. The live tenant does one of two
 * things instead, and the gate must be right under both:
 *
 *  - 'undeclared' (DEFAULT — what the deployed backend actually does): a filter
 *    on an attribute the type does not DECLARE is ACCEPTED and matches nothing.
 *    `count: 0`, the parameter reported in `applied_filters` and NOT in
 *    `ignored_filters`. `topic_ref` is undeclared on the draft type (verified
 *    live, bd startsim-8hgmq.4). A gate that narrows by it therefore counts
 *    zero drafts for every topic in the tenant, forever.
 *  - 'ignored': an UNRECOGNISED parameter is dropped and EVERY row comes back
 *    (the mirror, warned about in `foundry-api.ts`).
 */
function stubTenant(opts: {
  topic?: unknown;
  types?: unknown[];
  drafts?: unknown[];
  draftsNext?: string | null;
  fail?: boolean;
  attrFilter?: 'undeclared' | 'ignored';
  /** Django's raw whoami shape, or `null` to make ONLY that read fail. */
  whoami?: unknown;
}) {
  vi.mocked(tenantFetch).mockImplementation(async (path: string) => {
    if (path.startsWith('whoami')) {
      if (opts.whoami === null) throw new Error(`tenant GET ${path} responded 401`);
      // snake_case, like every other fixture here: `tenantFetch` returns
      // Django's JSON untouched, so `company_id` does NOT arrive camelised.
      return opts.whoami ?? { sub: CALLER_SUB, email: CALLER_EMAIL, company_id: 'c1', role: 'admin' };
    }
    if (opts.fail) throw new Error(`tenant GET ${path} is unreachable`);
    if (path.startsWith('schema/types')) {
      return { count: 1, next: null, previous: null, results: opts.types ?? [TOPIC_TYPE_WIRE] };
    }
    if (path.startsWith('entities?')) {
      const undeclared = (opts.attrFilter ?? 'undeclared') === 'undeclared';
      const drafts = path.includes('attr.') && undeclared ? [] : (opts.drafts ?? []);
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
  // The in-flight claim store is module-level and outlives a single test, which
  // is the whole point of it (bd startsim-8hgmq.8) — so a test must clear it.
  resetGenerateClaims();
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
    // THE 2026-09-07 DEFECT (bd startsim-8hgmq.3). This assertion is unchanged;
    // what changed is the fixture underneath it, which now answers
    // `attr.topic_ref` the way the live backend does — with nothing. Under the
    // old, filter-honouring stub this passed while production relayed the
    // writer a second time over a topic that already had three drafts.
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
      attrFilter: 'ignored',
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

  it('fails CLOSED when the draft listing runs out of pages before matching', async () => {
    // Dropping the `attr.topic_ref` narrowing (bd startsim-8hgmq.3) means this
    // gate now reads the draft corpus and matches in JS, bounded by
    // MAX_PAGES * PAGE_SIZE. `next` never clears here, so the walk ends still
    // holding a page it did not read, having matched nothing for this topic —
    // a count that was never established. Allowing on it would re-open the
    // silent double-write at a larger corpus size, so it is a 502, exactly as
    // an unreachable tenant is.
    stubTenant({
      topic: topicWire('ready'),
      drafts: [draftWire(1, 999)],
      draftsNext: 'http://tenant/entities?page=2',
    });

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

describe('who pressed it (bd startsim-8hgmq.7)', () => {
  it("relays the caller's EMAIL as triggered_by, resolved from the same bearer", async () => {
    // The route already holds the reviewer's bearer and already spends it on
    // the gate; one more read names her. Email and not `sub` because the column
    // this lands in is read by a person: whoami returns
    // {sub, email, companyId, orgId, role} and has no display name at all, so
    // the only legible choice is the email.
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      topic_ref: String(TOPIC_ID),
      trigger: 'generate_button',
      triggered_by: CALLER_EMAIL,
    });
  });

  it('relays ANYWAY when the caller cannot be resolved, and omits the key', async () => {
    // An unknown presser is a missing nicety, not a missing guard. Refusing the
    // generate over a whoami blip would be a far worse bug than an unattributed
    // draft — and an EMPTY triggered_by would be worse still, because the writer
    // omits the key when empty precisely so absence reads as "not known".
    stubTenant({ topic: topicWire('ready'), drafts: [], whoami: null });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.trigger).toBe('generate_button');
    expect('triggered_by' in body).toBe(false);
  });

  it('omits the key rather than sending a blank or non-string identity', async () => {
    stubTenant({ topic: topicWire('ready'), drafts: [], whoami: { sub: CALLER_SUB, email: '  ' } });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect('triggered_by' in (JSON.parse(String(init.body)) as Record<string, unknown>)).toBe(false);
  });
});

describe('the in-flight claim (bd startsim-8hgmq.8)', () => {
  it('does not fire a SECOND writer for a topic whose first run is still in flight', async () => {
    // THE DEFECT. The webhook answers "Workflow got started" immediately and the
    // drafts take ~100s to appear, so the drafts_exist gate — which counts
    // drafts that DO NOT EXIST YET — reads zero for both presses and relays
    // both. On 2026-09-07 that left six near-duplicate drafts in the reviewer's
    // queue and three had to be deleted by hand.
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    const first = await POST(post({ story: story() }));
    const second = await POST(post({ story: story() }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    // ONE writer, not two. The status is the same on purpose: the second press
    // is not an error to show the reader — a run for that topic IS under way and
    // its drafts are on the way — so the body says `deduped` and the drawer
    // keeps waiting instead of tearing its own run down over a 4xx.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await second.json()).toMatchObject({ ok: true, deduped: true });
    expect(await first.json()).toMatchObject({ ok: true, deduped: false });
  });

  it('claims per TOPIC, so a run for one topic never blocks another', async () => {
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    await POST(post({ story: story(TOPIC_ID) }));
    vi.mocked(tenantFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('whoami')) return { sub: CALLER_SUB, email: CALLER_EMAIL };
      if (path.startsWith('schema/types')) {
        return { count: 1, next: null, previous: null, results: [TOPIC_TYPE_WIRE] };
      }
      if (path.startsWith('entities?')) return { count: 0, next: null, previous: null, results: [] };
      return topicWire('ready', 777);
    });
    const other = await POST(post({ story: story(777) }));

    expect(other.status).toBe(202);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('RELEASES the claim when the relay fails, so a retry is not locked out', async () => {
    // The lockout risk is the reason a lock was not shipped with the gate fix.
    // The writer that never started must not hold the topic: every failure this
    // route can see gives the claim straight back.
    stubTenant({ topic: topicWire('ready'), drafts: [] });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 })) as unknown as typeof fetch;

    const failed = await POST(post({ story: story() }));
    const retry = await POST(post({ story: story() }));

    expect(failed.status).toBe(502);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ deduped: false });
  });

  it('releases the claim when the webhook is unreachable', async () => {
    stubTenant({ topic: topicWire('ready'), drafts: [] });
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 })) as unknown as typeof fetch;

    expect((await POST(post({ story: story() }))).status).toBe(502);
    expect((await POST(post({ story: story() }))).status).toBe(202);
  });

  it('lets drafts_exist answer first — the better refusal wins over the claim', async () => {
    // Once the drafts have landed, "this topic already has drafts" is a truer
    // and more useful answer than "a run is in flight", so the gate is resolved
    // before the claim is consulted and the claim never masks it.
    stubTenant({ topic: topicWire('ready'), drafts: [] });
    await POST(post({ story: story() }));

    stubTenant({
      topic: topicWire('ready'),
      drafts: [draftWire(1, TOPIC_ID), draftWire(2, TOPIC_ID), draftWire(3, TOPIC_ID)],
    });
    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason?: string }).reason).toBe('drafts_exist');
  });
});
