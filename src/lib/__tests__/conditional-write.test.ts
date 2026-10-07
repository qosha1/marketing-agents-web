/**
 * EVERY WRITE CARRIES THE VERSION IT LOADED, AND EXACTLY ONE OF THEM
 * (bd startsim-j19hf; server bd startsim-3c2wc; design bd startsim-j4kx6 §6).
 *
 * WHY THESE ASSERTIONS ARE ON THE WIRE AND NOT ON A RETURN VALUE. Every failure
 * mode this guard has is a property of the REQUEST, and each one is silent:
 *
 *  - a precondition that never leaves is a 200, which looks exactly like a save
 *    that was checked. The trail records `precondition: "none"`, but no browser
 *    reads the trail;
 *  - TWO preconditions that disagree is a 412 that looks exactly like a real
 *    conflict, because `preconditions.enforce` checks BOTH `If-Match` and
 *    `expected_version` rather than the first it finds and refuses if either is
 *    stale. A reviewer would be told somebody else changed the record when
 *    nobody had;
 *  - and `version: 0` read as "no version" unguards precisely the oldest records
 *    — every row that predates the trail reads 0, and 0 is a version the server
 *    accepts back.
 *
 * So these go through the real `@startsimpli/api` client against a stubbed
 * `fetch`, like entity-filters.test.ts beside them, and read the headers and the
 * body that actually went out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real @startsimpli/api client is deliberately NOT mocked — these assertions
// are about the bytes it emits. It does refuse an unsafe method with no bearer
// (packages/api no-token-unsafe-method), so the token provider is stubbed.
vi.mock('@/infrastructure/auth', () => ({
  getRegisteredToken: async () => 'test-token',
  registerTokenProvider: () => {},
}));

import {
  createEntity,
  entityWriteClient,
  getEntity,
  listEntities,
  resetDeclaredAliasIndex,
  updateEntity,
} from '../foundry-api';
import { heldVersion, rememberVersion, resetHeldVersions } from '../record-version';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const sent: Sent[] = [];
const realFetch = globalThis.fetch;

/** What the tenant answers next, newest-first (a queue of one-shot responses). */
let answers: Array<{ status: number; body: unknown }> = [];

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A record payload as the tenant serves it. */
function record(id: string, version: number | undefined, data: Record<string, unknown> = {}) {
  return {
    id,
    entity_type: 'draft',
    external_id: null,
    name: 'A draft',
    data,
    created_at: '2026-10-01T00:00:00Z',
    ...(version !== undefined ? { version } : {}),
  };
}

beforeEach(() => {
  sent.length = 0;
  answers = [];
  resetHeldVersions();
  resetDeclaredAliasIndex();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    sent.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    // `wireSafeData` fetches the declared schema before every write, and it must
    // not consume a queued answer — it is not what any of these tests is about.
    // An EMPTY index means no re-keying, which keeps the bodies below readable.
    if (url.includes('api/v1/schema/types')) {
      return respond(200, { count: 0, next: null, previous: null, results: [] });
    }
    const next = answers.shift();
    return next ? respond(next.status, next.body) : respond(200, record('d1', 1));
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The one PATCH that went out. */
function patched(): Sent {
  const writes = sent.filter((s) => s.method === 'PATCH');
  expect(writes).toHaveLength(1);
  return writes[0]!;
}

describe('a read remembers the version and the next write asserts it', () => {
  it('sends If-Match from the version a detail read reported', async () => {
    answers = [{ status: 200, body: record('d1', 7) }];
    await getEntity('d1');
    await updateEntity('d1', { data: { blog: 'edited' } });

    expect(patched().headers['if-match']).toBe('"7"');
    // ONE spelling. The body is untouched, which is the whole reason `header` is
    // the default: there is no path by which a precondition reaches the record.
    expect(patched().body).not.toHaveProperty('expected_version');
  });

  it('sends If-Match for a row that came from a LIST, not a detail read', async () => {
    // This is the path that matters for the review drawer, the inline review
    // actions and the board's lane move: those surfaces write a row the TABLE
    // fetched, through a shared `CollectionClient.updateEntity(id, input)` whose
    // signature has no room for a precondition and cannot grow one without a
    // meta-repo publish.
    answers = [
      {
        status: 200,
        body: { count: 2, next: null, previous: null, results: [record('a', 3), record('b', 9)] },
      },
    ];
    await listEntities('draft');
    await updateEntity('b', { data: { status: 'ready' } });

    expect(patched().headers['if-match']).toBe('"9"');
  });

  it('asserts version 0 rather than treating it as absent', async () => {
    // Every record that predates the revision trail reads 0, and the server
    // accepts 0 back. `if (version)` here would unguard exactly those rows.
    answers = [{ status: 200, body: record('d1', 0) }];
    await getEntity('d1');
    await updateEntity('d1', { data: { blog: 'x' } });

    expect(patched().headers['if-match']).toBe('"0"');
  });

  it('writes UNGUARDED, and succeeds, for a record it has never read', async () => {
    // The posture the server declares: enforce-when-present, optional when
    // absent. A guard that can make a save impossible is a worse bug than the
    // overwrite it prevents, so an unknown id falls through to today's behaviour
    // and the trail records `precondition: "none"` rather than this being silent.
    await updateEntity('never-read', { data: { blog: 'x' } });

    expect(patched().headers).not.toHaveProperty('if-match');
    expect(patched().body).not.toHaveProperty('expected_version');
  });

  it('advances the held version from the WRITE response, with no GET in between', async () => {
    // This is what lets a 1,200 ms autosave stay guarded: the save's own answer
    // carries the new version, so the next save needs no read.
    answers = [{ status: 200, body: record('d1', 4) }, { status: 200, body: record('d1', 5) }];
    await getEntity('d1');
    await updateEntity('d1', { data: { blog: 'one' } });

    expect(heldVersion('d1')).toBe(5);
    // One entity read — the initial load. The save's own answer carried the new
    // version, so nothing had to go and ask for it. (The schema fetch is
    // `wireSafeData`'s and is cached for the tab.)
    expect(sent.filter((s) => s.method === 'GET' && s.url.includes('/entities'))).toHaveLength(1);
  });

  it('remembers the version a CREATE was born at, and sends no precondition on it', async () => {
    answers = [{ status: 200, body: record('new-1', 1) }];
    await createEntity({ entityType: 'draft', name: 'n', data: {} });

    const post = sent.find((s) => s.method === 'POST')!;
    expect(post.headers).not.toHaveProperty('if-match');
    expect(heldVersion('new-1')).toBe(1);
  });
});

describe('a caller-owned precondition replaces the registry — never joins it', () => {
  it('sends only the caller’s spelling even when the registry holds a different version', async () => {
    // THE HAZARD. `enforce` checks both sources and refuses if EITHER disagrees,
    // so a request carrying the hook's validator beside a registry-derived one
    // refuses ITSELF — a 412 indistinguishable from a real conflict, arriving
    // whenever a background refetch moves one of the two.
    rememberVersion('d1', record('d1', 2));
    await updateEntity(
      'd1',
      { data: { blog: 'x' } },
      { precondition: { headers: { 'If-Match': '"11"' } } },
    );

    expect(patched().headers['if-match']).toBe('"11"');
    expect(patched().body).not.toHaveProperty('expected_version');
  });

  it('sends NOTHING when the caller owns the guard and has no version', async () => {
    // `useConditionalSave` with an unseeded version: the write still goes out,
    // and it must not pick one up from the registry behind the hook's back —
    // the hook is the thing that knows whether it has been refused.
    rememberVersion('d1', record('d1', 2));
    await updateEntity('d1', { data: { blog: 'x' } }, { precondition: {} });

    expect(patched().headers).not.toHaveProperty('if-match');
    expect(patched().body).not.toHaveProperty('expected_version');
  });
});

/**
 * A write merged over a record it is HOLDING asserts that record's version
 * (bd startsim-jkkn7.19). The registry is as new as the LAST read of an id, and
 * every list refetch moves it; a drawer's snapshot or a board card is as old as
 * ITS read. Pairing the second's blob with the first's version is a stale write
 * the server cannot tell from a current one.
 */
describe('basedOn — the version that travelled with the blob', () => {
  it('asserts the held record’s version even after a refetch moved the registry past it', async () => {
    rememberVersion('d1', { version: 3 }); // the drawer opened on v3
    rememberVersion('d1', { version: 4 }); // a list refetch saw somebody's v4
    await updateEntity('d1', { data: { blog: 'merged over v3' } }, { basedOn: { version: 3 } });

    expect(patched().headers['if-match']).toBe('"3"');
  });

  it('asserts version 0 rather than falling through to the registry', async () => {
    rememberVersion('d1', { version: 5 });
    await updateEntity('d1', { data: {} }, { basedOn: { version: 0 } });

    expect(patched().headers['if-match']).toBe('"0"');
  });

  it('falls back to the registry for a record that carries no version', async () => {
    rememberVersion('d1', { version: 7 });
    await updateEntity('d1', { data: {} }, { basedOn: {} });

    expect(patched().headers['if-match']).toBe('"7"');
  });

  it('is ignored when the caller owns the precondition — still one source per request', async () => {
    await updateEntity(
      'd1',
      { data: {} },
      { basedOn: { version: 3 }, precondition: { headers: { 'If-Match': '"9"' } } },
    );

    expect(patched().headers['if-match']).toBe('"9"');
    expect(patched().body).not.toHaveProperty('expected_version');
  });
});

describe('entityWriteClient — the 412 the shared client would otherwise swallow', () => {
  it('rebuilds detail AND current_version, because parseErrorResponse drops the latter', async () => {
    // `@startsimpli/api`'s `parseErrorResponse` keeps `detail` and `status` off a
    // plain DRF error and DISCARDS every other key, and puts `detail` on the
    // exception rather than in a body. Handed that through, the shared
    // `parseStaleSaveRefusal` would see `{status: 412}` with neither half: the
    // dialog would name nobody and "Save mine anyway" would send NO precondition
    // at all — an unguarded overwrite the trail would record as unchecked.
    answers = [
      { status: 200, body: record('d1', 3) },
      {
        status: 412,
        body: {
          detail: 'the record changed since it was loaded: version 3 was sent and the record is now at version 5.',
          current_version: 5,
        },
      },
      { status: 200, body: record('d1', 5) }, // the read-back
    ];
    await getEntity('d1');
    const outcome = await entityWriteClient('d1').write({
      body: { data: { blog: 'mine' } },
      headers: { 'If-Match': '"3"' },
    });

    expect(outcome.status).toBe(412);
    expect(outcome.body).toMatchObject({ current_version: 5 });
    expect(String((outcome.body as { detail: string }).detail)).toContain('version 3 was sent');
  });

  it('does NOT advance the held version on a refusal, even though it re-reads the record', async () => {
    // The re-read is how `current_version` is recovered, and it must not become
    // an adoption: if the registry took the version the refusal named, a second
    // click on an unguarded surface's Save would land and perform exactly the
    // overwrite the 412 prevented.
    answers = [
      { status: 200, body: record('d1', 3) },
      { status: 412, body: { detail: 'stale', current_version: 5 } },
      { status: 200, body: record('d1', 5) },
    ];
    await getEntity('d1');
    await entityWriteClient('d1').write({
      body: { data: { blog: 'mine' } },
      headers: { 'If-Match': '"3"' },
    });

    expect(heldVersion('d1')).toBe(3);
  });

  it('reports a successful write as 200 with the saved record as the body', async () => {
    // `versionFromWriteOutcome` reads the version out of the BODY and not the
    // ETag, because ETag is not CORS-safelisted and the tenant sets no
    // CORS_EXPOSE_HEADERS — a cross-origin read of it is `null`, silently, and
    // only on the write path.
    answers = [{ status: 200, body: record('d1', 6, { blog: 'mine' }) }];
    const outcome = await entityWriteClient('d1').write({
      body: { data: { blog: 'mine' } },
      headers: {},
    });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ id: 'd1', version: 6 });
  });

  it('lets a non-412 failure through, so the hook reports it instead of hiding it', async () => {
    // `save()` resolves rather than throwing, so a swallowed 500 would render as
    // a successful save. It has to reach the hook to become `{status: 'failed'}`.
    answers = [{ status: 500, body: { detail: 'boom' } }];
    await expect(
      entityWriteClient('d1').write({ body: { data: {} }, headers: {} }),
    ).rejects.toThrow();
  });

  it('still surfaces the conflict when the version read-back itself fails', async () => {
    // A failure here happens while the app is already reporting a conflict.
    // Losing the conflict because the follow-up read failed would put the
    // reviewer back in the editor with no idea their save did not land.
    answers = [
      { status: 412, body: { detail: 'stale' } },
      { status: 503, body: { detail: 'nope' } },
    ];
    const outcome = await entityWriteClient('d1').write({ body: { data: {} }, headers: {} });

    expect(outcome.status).toBe(412);
    expect(outcome.body).toMatchObject({ detail: 'stale' });
    expect(outcome.body).not.toHaveProperty('current_version');
  });
});
