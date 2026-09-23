'use client';

/**
 * The story page — where approving a topic lands (bd startsim-z384k).
 *
 * THE DECISION IT SERVES (design gate startsim-w4txa, Quinn 2026-09-22): the
 * reviewer no longer reads a draft inside a modal hanging off the topic table.
 * Approving a topic goes straight to the draft, with the topic's own context at
 * the top of that page. One page, no modal.
 *
 * WHY THIS ROUTE EXISTS AT ALL, given that the destination is /draft/<id>. A
 * freshly approved topic HAS NO DRAFT. The n8n writer takes ~2 minutes, and
 * startsim-nlpp4 named that gap as the thing that stalls a strict queue. "Go
 * straight to the draft detail page" has nowhere to go inside it. So the approve
 * lands HERE — on the topic, addressed by the topic's own id, which is the one
 * id that exists at the moment of the decision — and this page answers the only
 * question the reviewer has: is something being written for me?
 *
 * FOUR STATES, AND NONE OF THEM IS A BARE SPINNER:
 *
 *   exactly one draft   -> step straight into it (router.replace, so Back still
 *                          returns to the table rather than bouncing off this
 *                          page). This is the whole flow after startsim-yvi57:
 *                          one draft per topic, nothing to compare, nothing to
 *                          pick.
 *   no draft yet        -> the writer's real state, rendered — "generating,
 *                          ~2 min", or why the wait ended. That copy and the
 *                          poll behind it are `TopicDrafts`, reused here rather
 *                          than re-implemented: it already owns the run store,
 *                          the stall window and the gated Generate button.
 *   two or more         -> list them and let the reviewer choose. Drafts written
 *                          before 2026-09-16 come in threes and MUST not break;
 *                          auto-stepping into an arbitrary one of three would be
 *                          a silent pick.
 *   no link at all      -> said plainly, with a way out. 38 of 153 live drafts
 *                          carry no topic_ref (startsim-sr38f), so "no draft"
 *                          here can mean "written but unlinked". Asserting
 *                          absence as fact is the failure this page exists to
 *                          avoid, so it does not: it offers the drafts table.
 *
 * THIS PAGE DOES NOT START THE WRITER. startsim-rc92e owns that, and it has real
 * collisions to settle first (the n8n poll already auto-writes `ready` topics,
 * so app-side auto-fire races it; and the draft's `_trigger` provenance has to
 * stop claiming somebody pressed a button). Until then the existing gated
 * "Generate drafts" control is right here on the landing page, so the flow is
 * complete today without pre-empting that decision.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { TopicDrafts } from '@/components/entity-detail-drawer';
import {
  TopicBackLink,
  TopicContextHeader,
} from '@/components/draft-review/TopicContextHeader';
import { entityKey } from '@/lib/entity-cache';
import { readData } from '@/lib/board';
import { CONTENT_TYPE_ATTR, CONTENT_TYPE_KEY } from '@/lib/content';
import { getEntity, listTypes, type EntityRecord } from '@/lib/foundry-api';
import { draftHref, FROM_PARAM, returnTarget, safeReturnPath } from '@/lib/story-nav';
import { DRAFT_TYPE, TOPIC_REF_ATTR } from '@/lib/topic-drafts';

export default function StoryPage() {
  const params = useParams<{ topicId: string }>();
  const topicId = String(params.topicId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = safeReturnPath(searchParams.get(FROM_PARAM));

  const topicQuery = useQuery({
    queryKey: entityKey(topicId),
    queryFn: () => getEntity(topicId),
  });
  const typesQuery = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });
  const topicType = (typesQuery.data?.results ?? []).find((t) => t.key === CONTENT_TYPE_KEY);

  const topic = topicQuery.data ?? null;
  const contentType = topic ? String(readData(topic.data, CONTENT_TYPE_ATTR) ?? '') : '';
  const back = useMemo(() => returnTarget(from, contentType), [from, contentType]);

  // A lone draft is stepped into ONCE. `replace`, not `push`: this page is a
  // landing, not a destination, and a history entry here would make the browser
  // Back button bounce the reviewer straight back into the redirect.
  const stepped = useRef(false);
  const [drafts, setDrafts] = useState<EntityRecord[]>([]);
  const [countKnown, setCountKnown] = useState(false);

  const onDrafts = useCallback((next: EntityRecord[], loading: boolean) => {
    setDrafts(next);
    setCountKnown(!loading);
  }, []);

  useEffect(() => {
    if (stepped.current || !countKnown || drafts.length !== 1) return;
    stepped.current = true;
    router.replace(draftHref(drafts[0].id, from));
  }, [countKnown, drafts, from, router]);

  if (topicQuery.isLoading || typesQuery.isLoading) {
    return <p className="text-sm text-neutral-500">Loading topic…</p>;
  }
  if (topicQuery.isError || !topic || !topicType) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-500">Couldn’t load this topic.</p>
        <Link href={back.href} className="text-sm text-neutral-600 underline">
          {back.label}
        </Link>
      </div>
    );
  }

  const unlinked = countKnown && drafts.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <TopicContextHeader
        topic={topic}
        type={topicType}
        alwaysOpen
        backLink={<TopicBackLink href={back.href} label={back.label} />}
      />

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        {/* The writer's state, the gated Generate control and the candidate list
            are ONE component — the same one the drawer renders — so the poll,
            the stall window and the "why did the wait end" copy cannot drift
            into a second implementation on the surface that now matters most. */}
        <TopicDrafts topic={topic} type={topicType} from={from} onDrafts={onDrafts} />

        {unlinked ? (
          // Never assert absence as fact: a draft with no `topic_ref` is
          // invisible to this query and very much not missing (startsim-sr38f).
          <p className="mt-3 border-t border-border pt-3 text-xs text-neutral-500">
            Nothing is <em>linked</em> to this topic. A draft written before
            drafts carried a <code>{TOPIC_REF_ATTR}</code> cannot appear here
            even though it exists —{' '}
            <Link href={`/t/${DRAFT_TYPE}`} className="underline hover:text-neutral-800">
              search the drafts table
            </Link>{' '}
            before concluding one was never written.
          </p>
        ) : null}
      </div>
    </div>
  );
}
