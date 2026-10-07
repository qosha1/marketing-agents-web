/**
 * Accept is two writes to two records, and must not leave them disagreeing
 * (bd startsim-jkkn7.13).
 *
 * /draft Accept flips the draft to chosen + approved, then moves its topic to
 * `written`. Before this, the topic write merged `status: written` over the
 * topic blob the page loaded — possibly minutes old — and asserted whatever
 * version the registry last saw. A 412 there arrived AFTER the draft was already
 * approved, so the queue showed an approved draft under an unwritten topic.
 *
 * The real `@startsimpli/api` client runs here; only `fetch` is faked, so every
 * assertion is about the bytes that leave the browser. The one property no fix
 * may trade away is pinned in every case: EVERY topic PATCH carries If-Match.
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/auth', () => ({
  getRegisteredToken: async () => 'test-token',
  registerTokenProvider: () => {},
}));

import { acceptDraft } from '../accept-draft';
import { resetDeclaredAliasIndex, type EntityRecord } from '../foundry-api';
import { resetHeldVersions } from '../record-version';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
const sent: Sent[] = [];
const realFetch = globalThis.fetch;
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

const TOPIC_ID = 't1';

function topicRow(version: number, data: Record<string, unknown>) {
  return {
    id: TOPIC_ID,
    entity_type: 'topic',
    external_id: null,
    name: 'Qatar customs',
    data,
    created_at: '2026-10-01T00:00:00Z',
    version,
  };
}
const REFUSED = {
  status: 412,
  body: { detail: 'This record changed since you loaded it (you had version 5, it is now 6).' },
};

/** The topic as the page READ it, minutes ago: version 3, status ready. */
const SEEN = {
  id: TOPIC_ID,
  entityType: 'topic',
  name: 'Qatar customs',
  data: { status: 'ready', teamVerdict: 'good', teamNotes: 'old note' },
  version: 3,
} as unknown as EntityRecord;

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
    if (url.includes('api/v1/schema/types')) {
      return respond(200, { count: 0, next: null, previous: null, results: [] });
    }
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
    return respond(next.status, next.body);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function topicPatches(): Sent[] {
  return sent.filter((s) => s.method === 'PATCH' && s.url.includes(`entities/${TOPIC_ID}`));
}

function deps(approved = true, restored = true) {
  return {
    approveDraft: vi.fn(async () => approved),
    restoreDraft: vi.fn(async () => restored),
  };
}

function run(d = deps()) {
  return acceptDraft({ qc: new QueryClient(), topic: SEEN, ...d });
}

describe('accepting a draft moves its topic to written', () => {
  it('merges onto the topic it RE-READ, asserting that version', async () => {
    // Someone edited the topic's note since the page read it (v3 -> v5). The old
    // code merged over the v3 blob and would have erased that note.
    answers = [
      { status: 200, body: topicRow(5, { status: 'ready', team_verdict: 'good', team_notes: 'new note' }) },
      { status: 200, body: topicRow(6, { status: 'written', team_verdict: 'good', team_notes: 'new note' }) },
    ];
    const d = deps();
    const outcome = await run(d);

    expect(outcome.status).toBe('accepted');
    expect(d.approveDraft).toHaveBeenCalledTimes(1);
    expect(d.restoreDraft).not.toHaveBeenCalled();
    const [patch] = topicPatches();
    expect(topicPatches()).toHaveLength(1);
    expect(patch!.headers['if-match']).toBe('"5"');
    const data = patch!.body.data as Record<string, unknown>;
    expect(data.status).toBe('written');
    expect(data.team_notes).toBe('new note');
  });

  it('writes NOTHING when the topic’s decision moved since the page read it', async () => {
    // Somebody reverted the topic to suggested. Accepting must not quietly
    // overrule that — and must not approve the draft either.
    answers = [{ status: 200, body: topicRow(4, { status: 'suggested', team_verdict: 'good' }) }];
    const d = deps();
    const outcome = await run(d);

    expect(outcome).toMatchObject({ status: 'topic-moved', topicStatus: 'suggested' });
    expect(d.approveDraft).not.toHaveBeenCalled();
    expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(0);
  });

  it('writes no topic when the draft’s own save did not land', async () => {
    answers = [{ status: 200, body: topicRow(5, { status: 'ready', team_verdict: 'good' }) }];
    const d = deps(false);
    const outcome = await run(d);

    expect(outcome.status).toBe('draft-not-saved');
    expect(topicPatches()).toHaveLength(0);
    expect(d.restoreDraft).not.toHaveBeenCalled();
  });
});

describe('when the topic write is refused', () => {
  it('re-reads once and retries — still guarded — if only other fields moved', async () => {
    answers = [
      { status: 200, body: topicRow(5, { status: 'ready', team_verdict: 'good' }) },
      REFUSED,
      { status: 200, body: topicRow(6, { status: 'ready', team_verdict: 'good', angle: 'sharper' }) },
      { status: 200, body: topicRow(7, { status: 'written', team_verdict: 'good', angle: 'sharper' }) },
    ];
    const d = deps();
    const outcome = await run(d);

    expect(outcome.status).toBe('accepted');
    const patches = topicPatches();
    expect(patches.map((p) => p.headers['if-match'])).toEqual(['"5"', '"6"']);
    // The retry carries the concurrent edit — it is a merge, not a re-send.
    expect((patches[1]!.body.data as Record<string, unknown>).angle).toBe('sharper');
    expect(d.restoreDraft).not.toHaveBeenCalled();
  });

  it('does not retry over a decision somebody else made — it puts the draft back', async () => {
    answers = [
      { status: 200, body: topicRow(5, { status: 'ready', team_verdict: 'good' }) },
      REFUSED,
      { status: 200, body: topicRow(6, { status: 'rejected', team_verdict: 'bad' }) },
    ];
    const d = deps();
    const outcome = await run(d);

    expect(outcome).toMatchObject({ status: 'topic-refused', draftRestored: true });
    expect(topicPatches()).toHaveLength(1);
    expect(d.restoreDraft).toHaveBeenCalledTimes(1);
  });

  it('retries at most ONCE, then puts the draft back', async () => {
    answers = [
      { status: 200, body: topicRow(5, { status: 'ready', team_verdict: 'good' }) },
      REFUSED,
      { status: 200, body: topicRow(6, { status: 'ready', team_verdict: 'good' }) },
      REFUSED,
    ];
    const d = deps();
    const outcome = await run(d);

    expect(outcome).toMatchObject({ status: 'topic-refused', draftRestored: true });
    expect(topicPatches()).toHaveLength(2);
    expect(topicPatches().every((p) => p.headers['if-match'])).toBe(true);
    expect(d.restoreDraft).toHaveBeenCalledTimes(1);
  });

  it('puts the draft back on a non-412 failure too, without retrying', async () => {
    answers = [
      { status: 200, body: topicRow(5, { status: 'ready', team_verdict: 'good' }) },
      { status: 500, body: { detail: 'boom' } },
    ];
    const d = deps();
    const outcome = await run(d);

    expect(outcome).toMatchObject({ status: 'topic-refused', draftRestored: true });
    expect(topicPatches()).toHaveLength(1);
  });

  it('says so when the draft could not be put back either', async () => {
    answers = [
      { status: 200, body: topicRow(5, { status: 'ready', team_verdict: 'good' }) },
      { status: 500, body: { detail: 'boom' } },
    ];
    const outcome = await run(deps(true, false));

    expect(outcome).toMatchObject({ status: 'topic-refused', draftRestored: false });
  });
});
