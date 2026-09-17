/**
 * What "Request revision" sends (bd startsim-0r7ru).
 *
 * THE DEFECT THIS FIXES. The reviewer's critique goes to the n8n reviser, which
 * GPT-rewrites the draft and POSTs a NEW draft record back to the tenant. Since
 * the multi-scope guard landed (startsim-8qn5l), the tenant refuses a pathless
 * row of a scoped type — and the payload carried no scope at all, so every
 * revision 400'd. Invisibly: the webhook answers "Workflow got started"
 * immediately, the route returns 202 on that, and the reviewer watches for a
 * revision that was never written.
 *
 * THE SCOPE IS THE PARENT DRAFT'S, and that is a rule, not a convenience. A
 * revision belongs in the same scope as the draft it revises: hardcoding
 * '/ogmc' would put a test account's revision into the customer's review queue,
 * which is the failure the scope gate exists to prevent. The app therefore
 * reads it off the record it already has and never invents one — when the
 * parent carries none the key is OMITTED, and n8n's own omit-rather-than-
 * default rule takes it from there.
 *
 * `parent_draft_id` IS ALREADY THE PARENT'S ID, so the pairing is not a new
 * idea here — the payload already says which draft this revises. What was
 * missing is where that draft LIVES.
 */
import { describe, expect, it } from 'vitest';

import type { EntityRecord } from '@/lib/foundry-api';
import { buildRevisionPayload } from '@/lib/revision-request';

function draft(data: Record<string, unknown>, id: string | number = 'draft-1'): EntityRecord {
  return {
    id: id as EntityRecord['id'],
    entityType: 'draft',
    externalId: 'a-draft',
    name: 'A Draft',
    data,
    createdAt: '2026-09-17T00:00:00Z',
  };
}

const CRITIQUE = {
  contentType: 'weekly_brief',
  market: 'UAE',
  feedback: 'Tighten the opening and cite the source.',
  blog: '## A heading\n\nBody.',
  linkedin: 'A post.',
  sources: 'Arab News (2026-07-13) https://example.com',
};

describe('buildRevisionPayload', () => {
  it('carries the PARENT draft’s scope path', () => {
    const body = buildRevisionPayload({
      draft: draft({ topic_ref: '4242', scope_path: '/ogmc' }),
      ...CRITIQUE,
    });

    expect(body.scope_path).toBe('/ogmc');
  });

  it('inherits a sandbox scope rather than the customer’s — never hardcoded', () => {
    // The whole reason the path is read from the record: an agent test account's
    // revision must land in its own scope. A constant here would drop it into
    // OGMC's queue in front of the customer.
    const body = buildRevisionPayload({
      draft: draft({ topic_ref: '99', scopePath: '/ogmc-agent-test' }),
      ...CRITIQUE,
    });

    expect(body.scope_path).toBe('/ogmc-agent-test');
  });

  it('OMITS the key when the parent carries no scope — it does not default one', () => {
    // `in`, not a value check: an empty string would pass a truthiness test on
    // the n8n side and is exactly the shape that would be invisible end to end.
    const body = buildRevisionPayload({ draft: draft({ topic_ref: '4242' }), ...CRITIQUE });

    expect('scope_path' in body).toBe(false);
  });

  it('still sends everything the reviser already relied on', () => {
    const body = buildRevisionPayload({
      draft: draft({ topic_ref: '4242', scope_path: '/ogmc' }, 77),
      ...CRITIQUE,
    });

    expect(body).toEqual({
      topic_ref: '4242',
      content_type: 'weekly_brief',
      market: 'UAE',
      feedback: 'Tighten the opening and cite the source.',
      blog: '## A heading\n\nBody.',
      linkedin: 'A post.',
      sources: 'Arab News (2026-07-13) https://example.com',
      parent_draft_id: '77',
      scope_path: '/ogmc',
    });
  });

  it('reads topic_ref off the parent under either spelling, as it always did', () => {
    expect(buildRevisionPayload({ draft: draft({ topicRef: '4242' }), ...CRITIQUE }).topic_ref)
      .toBe('4242');
    expect(buildRevisionPayload({ draft: draft({}), ...CRITIQUE }).topic_ref).toBe('');
  });
});
