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
 * TWO THINGS KEEP THIS FILE OFF THE LIVE WRITER, and it needs both.
 * `global.fetch` is stubbed in `beforeEach`, and `N8N_WRITER_WEBHOOK_URL` is set
 * to a URL that goes nowhere. The stub alone was the whole guard until
 * 2026-10-06, when the same missing variable let a DEV SERVER relay
 * `ogmc-generate-drafts-7h3k9x2q` — the real, uncredentialed OGMC writer — and
 * put a draft into the customer's queue. The route refuses an unset variable
 * outside production now, so this is belt-and-braces rather than the only belt;
 * setting it here also means these tests exercise the same arm production does
 * instead of the refusal.
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

import { DISPATCH_STAMP_ATTR } from '@/lib/dispatch-stamp';
import { APPROVAL_TRIGGER, GENERATE_BUTTON_TRIGGER } from '@/lib/draft-origin';
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
function topicWire(status: string, id: number = TOPIC_ID, scopePath?: string) {
  return {
    id,
    entity_type: 'topic',
    external_id: `topic-${id}`,
    name: 'A Topic',
    data: { status, ...(scopePath === undefined ? {} : { scope_path: scopePath }) },
  };
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
  // See the file header. Not a convenience: without it the route refuses
  // outright (NODE_ENV is 'test'), and every assertion below would be about a
  // 503 rather than about the gate.
  vi.stubEnv('N8N_WRITER_WEBHOOK_URL', 'http://127.0.0.1:1/no-writer-in-tests');
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

describe('the scope the writer stamps (bd startsim-0r7ru)', () => {
  it("relays the TOPIC's scope path, read from the tenant on the way past", async () => {
    // The tenant gates records by scope, so a draft written for this topic has
    // to land where the topic lives. The route already reads the topic to gate
    // the press — the scope comes off that same read, not a second fetch and not
    // the caller's word for it.
    stubTenant({ topic: topicWire('ready', TOPIC_ID, '/ogmc-agent-test'), drafts: [] });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      topic_ref: String(TOPIC_ID),
      scope_path: '/ogmc-agent-test',
    });
  });

  it('OMITS the key when the topic carries no scope, rather than defaulting one', async () => {
    // `in`, not a value check (the same reason `triggered_by` is tested this
    // way): the webhook coerces with `|| ''` and the writer falls back when the
    // value is empty, so an app that sent `''` would look identical end to end
    // while having silently decided the scope for everybody.
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect('scope_path' in (JSON.parse(String(init.body)) as Record<string, unknown>)).toBe(false);
  });

  it("takes the tenant's answer over a scope the caller put in the story", async () => {
    // Same reasoning as the gate this route exists for: the story is a body an
    // authenticated tab composed, so it cannot be the authority on which scope a
    // draft is written into. A caller-supplied path would let one tenant's press
    // write into another's queue — the exact failure the scope gate prevents.
    stubTenant({ topic: topicWire('ready', TOPIC_ID, '/ogmc'), drafts: [] });

    const res = await POST(post({ story: { ...story(), scope_path: '/somewhere-else' } }));

    expect(res.status).toBe(202);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ scope_path: '/ogmc' });
  });

  it('drops a caller-supplied scope entirely when the topic has none', async () => {
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    const res = await POST(post({ story: { ...story(), scopePath: '/somewhere-else' } }));

    expect(res.status).toBe(202);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect('scope_path' in body).toBe(false);
    expect('scopePath' in body).toBe(false);
  });
});

describe('which act the relay names (bd startsim-m7fdm.19)', () => {
  /** The relayed webhook body. */
  function relayed(): Record<string, unknown> {
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it('relays topic_approved when the approval dispatched it', async () => {
    // THE WHOLE POINT OF ACCEPTING THE FIELD. The writer stamps `trigger` as
    // `data._trigger` and `lib/draft-origin.ts` renders it in the "Created by"
    // column; a dispatch that reused `generate_button` would make every
    // auto-written draft claim somebody pressed a button, undoing that column.
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    const res = await POST(post({ story: story(), trigger: APPROVAL_TRIGGER }));

    expect(res.status).toBe(202);
    expect(relayed()).toMatchObject({ trigger: 'topic_approved', triggered_by: CALLER_EMAIL });
  });

  it('still resolves the IDENTITY from the bearer, never from the body', async () => {
    // The split that makes accepting a body field honest: the LABEL is the
    // caller's to name, the PERSON is not. A tab that could name the person
    // could attribute a draft to somebody else.
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    await POST(post({ story: story(), trigger: APPROVAL_TRIGGER, triggered_by: 'someone@else.test' }));

    expect(relayed()).toMatchObject({ triggered_by: CALLER_EMAIL });
  });

  it('defaults to generate_button when the body says nothing — the drawer’s POST is unchanged', async () => {
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    await POST(post({ story: story() }));

    expect(relayed()).toMatchObject({ trigger: GENERATE_BUTTON_TRIGGER });
  });

  it('refuses to relay a trigger it does not recognise, including "schedule"', async () => {
    // An unvetted string would let a tab write arbitrary text into a column
    // every reviewer reads — and `schedule` specifically would have an app-driven
    // draft claim the unattended poller wrote it. The poller calls the webhook
    // directly and never comes through here.
    for (const claimed of ['schedule', 'topic_approved ', 'whatever', 42, { a: 1 }]) {
      vi.mocked(global.fetch).mockClear();
      resetGenerateClaims();
      stubTenant({ topic: topicWire('ready'), drafts: [] });

      const res = await POST(post({ story: story(), trigger: claimed }));

      expect(res.status).toBe(202);
      expect(relayed()).toMatchObject({ trigger: GENERATE_BUTTON_TRIGGER });
    }
  });
});

describe('telling the n8n poll a writer is running (bd startsim-m7fdm.19, constraint 4)', () => {
  /** Every PATCH the route made against the tenant. */
  function patches() {
    return vi
      .mocked(tenantFetch)
      .mock.calls.filter(([, , init]) => (init as { method?: string } | undefined)?.method === 'PATCH');
  }

  it('stamps the topic AFTER the webhook accepted, so the poll skips it', async () => {
    // The poll's dedup is "ready, and no draft carries this topic_ref" — correct,
    // and blind for the whole length of a writer run, because the drafts it looks
    // for do not exist yet. The stamp is the fact it is missing.
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    expect(patches()).toHaveLength(1);
    const [path, , init] = patches()[0] as [string, string, { body?: { data?: Record<string, unknown> } }];
    expect(path).toBe(`entities/${TOPIC_ID}`);
    const stamp = init.body?.data?.[DISPATCH_STAMP_ATTR];
    expect(typeof stamp).toBe('string');
    expect(Date.parse(String(stamp))).toBeGreaterThan(0);
  });

  it('KEEPS the rest of the blob — the tenant PATCH replaces `data` wholesale', async () => {
    // A body carrying only the stamp would empty the customer's topic.
    stubTenant({
      topic: { ...topicWire('ready'), data: { status: 'ready', title: 'Qatar customs', market: 'UAE' } },
      drafts: [],
    });

    await POST(post({ story: story() }));

    const [, , init] = patches()[0] as [string, string, { body?: { data?: Record<string, unknown> } }];
    expect(init.body?.data).toMatchObject({ status: 'ready', title: 'Qatar customs', market: 'UAE' });
  });

  it('is stamped for the BUTTON too, not just for an approval', async () => {
    // The retry is the press most likely to collide with the poll: a retry is by
    // definition a `ready` topic with no draft, which is exactly what
    // `Pick Unwritten Ready` selects on.
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    await POST(post({ story: story(), trigger: GENERATE_BUTTON_TRIGGER }));

    expect(patches()).toHaveLength(1);
  });

  it('never stamps a relay that did not happen', async () => {
    stubTenant({ topic: topicWire('suggested') });
    expect((await POST(post({ story: story() }))).status).toBe(403);
    expect(patches()).toHaveLength(0);

    resetGenerateClaims();
    vi.mocked(tenantFetch).mockClear();
    stubTenant({ topic: topicWire('ready'), drafts: [] });
    global.fetch = vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    expect((await POST(post({ story: story() }))).status).toBe(502);
    expect(patches()).toHaveLength(0);
  });

  it('STILL answers 202 when the stamp write fails', async () => {
    // By then the writer is already running. A 502 here would make the drawer
    // end its run and the reviewer press the button again — manufacturing the
    // duplicate the stamp exists to prevent.
    stubTenant({ topic: topicWire('ready'), drafts: [] });
    const reads = vi.mocked(tenantFetch).getMockImplementation()!;
    vi.mocked(tenantFetch).mockImplementation(async (path: string, auth: string, init) => {
      if ((init as { method?: string }).method === 'PATCH') {
        throw new Error(`tenant PATCH ${path} responded 403`);
      }
      return reads(path, auth, init);
    });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, deduped: false });
  });
});

describe('the webhook URL is EARNED, not assumed (the 2026-10-06 incident)', () => {
  it('refuses to relay when no webhook is configured outside production', async () => {
    // The default is the LIVE OGMC writer. A dev server, a preview, or a test
    // harness that reaches it fires a real run against a real customer tenant —
    // which is exactly what happened, from a topic that existed only on a
    // laptop. Refusing is loud, local, and costs nothing.
    vi.stubEnv('N8N_WRITER_WEBHOOK_URL', '');
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    const res = await POST(post({ story: story() }));

    expect(res.status).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses BEFORE it reads the tenant or claims a run', async () => {
    // Nothing after the refusal is useful, and a claim left behind would refuse
    // the next press for 130 seconds over a relay that never happened.
    vi.stubEnv('N8N_WRITER_WEBHOOK_URL', '   ');
    stubTenant({ topic: topicWire('ready'), drafts: [] });

    await POST(post({ story: story() }));

    expect(tenantFetch).not.toHaveBeenCalled();
  });
});
