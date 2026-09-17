/**
 * What "Request revision" sends to the n8n reviser (bd startsim-0r7ru).
 *
 * The reviewer's critique goes to a webhook, GPT rewrites the draft, and the
 * reviser POSTs a NEW draft record back into the tenant stamped
 * `revised_from = <this draft>`. Since the multi-scope guard landed
 * (startsim-8qn5l) the tenant refuses a pathless row of a scoped type, and this
 * payload carried no scope at all — so from 2026-09-02 every revision 400'd
 * where nobody could see it: the webhook answers immediately, the route returns
 * 202 on that, and the reviewer waits for a revision that was never written.
 *
 * THE SCOPE IS THE PARENT DRAFT'S. A revision belongs in the same scope as the
 * draft it revises — the payload already says WHICH draft that is
 * (`parent_draft_id`); this adds where it LIVES. Hardcoding '/ogmc' would have
 * been shorter and is the thing this must not do: it would drop an agent test
 * account's revision into a paying customer's review queue, which is the exact
 * failure the scope gate exists to prevent. When the parent carries no scope the
 * key is OMITTED, and the reviser omits it from the draft in turn — a refusal is
 * the status quo, a wrong scope is not.
 *
 * IT IS A FUNCTION, NOT AN OBJECT LITERAL IN THE PAGE, for one reason: the
 * payload is the contract between this app and a workflow that lives somewhere
 * else, and a contract nothing can assert is how it fell out of step in the
 * first place. The page still owns the critique — compiling the feedback,
 * reading the sections and the sources rows — and hands the finished strings in.
 */
import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';
import { recordScopePath } from '@/lib/scope';
import { TOPIC_REF_ATTR } from '@/lib/topic-drafts';

export interface RevisionRequest {
  /** The draft being revised — the source of the topic link AND the scope. */
  draft: EntityRecord;
  contentType: string;
  market: string;
  feedback: string;
  blog: string;
  linkedin: string;
  sources: string;
}

/** camelCase-aware read of a data value as a string ('' when absent). */
function str(data: EntityRecord['data'], name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v);
}

/**
 * The body POSTed to `/actions/request-revision`, which relays it verbatim to
 * the reviser webhook. Every key here is one the webhook's "Build Revise Input"
 * node reads off `$json.body`, so the names are snake_case and are not free to
 * change on this side alone.
 */
export function buildRevisionPayload(input: RevisionRequest): Record<string, unknown> {
  const scopePath = recordScopePath(input.draft.data);
  return {
    topic_ref: str(input.draft.data, TOPIC_REF_ATTR),
    content_type: input.contentType,
    market: input.market,
    feedback: input.feedback,
    blog: input.blog,
    linkedin: input.linkedin,
    sources: input.sources,
    parent_draft_id: String(input.draft.id),
    // Omitted, never defaulted — see the header.
    ...(scopePath ? { scope_path: scopePath } : {}),
  };
}
