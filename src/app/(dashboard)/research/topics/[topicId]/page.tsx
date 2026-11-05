'use client';

/**
 * Research > one topic (bd startsim-cg3km): the documents behind it, one button,
 * and the content already made from it. Deliberately nothing else — no brief
 * field, no tick boxes, no "Work on this".
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, notify } from '@startsimpli/ui';
import { PenLine } from 'lucide-react';

import { ResearchHead, plural } from '@/components/research/page-head';
import { getEntity, listEntities, listTypes, type EntityRecord } from '@/lib/foundry-api';
import { humanizeChoice, readData } from '@/lib/board';
import { endGenerateRun } from '@/lib/generate-run';
import { contentHref, startContent, waitForDraft } from '@/lib/research/start-content';
import { documentLine, documentSpan, excerptOf, formatDay, topicSourceUrls, topicTitle } from '@/lib/research/topics';
import { draftStatus, draftTitle, fetchTopicDrafts } from '@/lib/topic-drafts';

const str = (v: unknown) => (v == null ? '' : String(v));

export default function ResearchTopicPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'starting' | 'writing'>('idle');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const topicQuery = useQuery({ queryKey: ['research', 'topic', topicId], queryFn: () => getEntity(topicId), retry: 1 });
  const typesQuery = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });
  const topic = topicQuery.data ?? null;
  const urls = topic ? topicSourceUrls(topic) : [];

  const docsQuery = useQuery({
    queryKey: ['research', 'topic-docs', topicId, urls],
    enabled: urls.length > 0,
    queryFn: () => listEntities('news_item', 1, { 'attr.url__in': urls.join(','), page_size: '50' }),
  });
  const draftsQuery = useQuery({
    queryKey: ['research', 'topic-content', topicId],
    enabled: !!topic,
    queryFn: () => fetchTopicDrafts(topic!),
    // The app's 5-minute staleTime would hide content started a moment ago when you come back.
    refetchOnMount: 'always',
  });

  if (topicQuery.isLoading) return <p className="text-sm text-neutral-500">Loading topic…</p>;
  if (topicQuery.isError || !topic) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-500">Couldn’t load this topic.</p>
        <Link href="/research/topics" className="text-sm text-neutral-600 underline">← Topics</Link>
      </div>
    );
  }

  const found = docsQuery.data?.results ?? [];
  const foundUrls = new Set(found.map((d) => str(readData(d.data, 'url'))));
  // A cited address with no pulled-in document behind it is still shown, as a bare link.
  const loose = docsQuery.isSuccess ? urls.filter((u) => !foundUrls.has(u)) : [];
  const drafts = draftsQuery.data ?? [];
  const angle = str(readData(topic.data, 'angle'));
  const market = str(readData(topic.data, 'market'));
  const span = documentSpan(found) || formatDay(topic.createdAt);

  async function onStart() {
    if (!topic || phase !== 'idle') return;
    setPhase('starting');
    try {
      const type = typesQuery.data?.results.find((t) => t.key === 'topic');
      let result = await startContent(topic, type);
      if (result.state === 'writing') {
        setPhase('writing');
        const draft = await waitForDraft(topic, (t) => fetchTopicDrafts(t));
        if (!draft) {
          endGenerateRun(topic.id, 'no_response');
          throw new Error('the writer has not answered yet. Try again in a moment');
        }
        endGenerateRun(topic.id, 'drafts_arrived');
        result = { state: 'open', href: contentHref(draft.id) };
      }
      if (result.state === 'open') router.push(result.href);
      else if (alive.current) setPhase('idle'); // refused: the relay already said why
    } catch (err) {
      notify.error(err instanceof Error ? `Couldn’t start content: ${err.message}` : 'Couldn’t start content.');
      if (alive.current) setPhase('idle');
    }
  }

  return (
    <div className="space-y-5">
      <ResearchHead
        title={topicTitle(topic)}
        back={{ href: '/research/topics', label: 'Topics' }}
        chips={[plural(urls.length, 'source'), ...(market ? [market] : [])]}
        sub={span}
        note={angle}
        action={
          <Button onClick={onStart} disabled={phase !== 'idle'}>
            <PenLine className="mr-1.5 h-3.5 w-3.5" />
            {phase === 'idle' ? 'Start content' : phase === 'starting' ? 'Starting…' : 'Writing the draft…'}
          </Button>
        }
      />
      {phase === 'writing' ? (
        <p className="text-sm text-neutral-500">Writing the draft from these documents. It opens here when it is ready (about 2 minutes).</p>
      ) : null}

      <section className="space-y-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Documents in this topic</h2>
        <div className="rounded-xl border border-border bg-card">
          {docsQuery.isLoading ? <p className="px-4 py-3 text-sm text-neutral-500">Loading documents…</p> : null}
          {found.map((d) => (
            <DocumentItem key={d.id} doc={d} />
          ))}
          {loose.map((u) => (
            <div key={u} className="border-b border-slate-100 px-4 py-3.5 text-sm last:border-b-0">
              {/^https?:\/\//i.test(u) ? (
                <a href={u} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline">{u}</a>
              ) : (
                <span className="font-semibold text-neutral-800">{u}</span>
              )}
            </div>
          ))}
          {docsQuery.isSuccess && found.length + loose.length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-500">No documents are linked to this topic yet.</p>
          ) : null}
        </div>
      </section>

      {drafts.length > 0 ? (
        <section className="space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Content made from this topic</h2>
          <div className="rounded-xl border border-border bg-card">
            {drafts.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                <Link href={contentHref(d.id)} className="min-w-0 truncate font-medium text-indigo-700 hover:underline">
                  {draftTitle(d)}
                </Link>
                {draftStatus(d) ? (
                  <span className="inline-flex h-[22px] shrink-0 items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 text-xs text-indigo-700">
                    {humanizeChoice(draftStatus(d))}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs text-neutral-500">Started {formatDay(d.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DocumentItem({ doc }: { doc: EntityRecord }) {
  const url = str(readData(doc.data, 'url'));
  const title = str(readData(doc.data, 'title')) || doc.name;
  const excerpt = excerptOf(doc);
  return (
    <div className="space-y-1 border-b border-slate-100 px-4 py-3.5 last:border-b-0">
      <a href={url || undefined} target="_blank" rel="noreferrer" className="block font-semibold text-indigo-700 hover:underline">
        {title}
      </a>
      <p className="text-xs text-neutral-500">{documentLine(doc)}</p>
      {excerpt ? <p className="text-[13px] leading-[18px] text-slate-700">“{excerpt}”</p> : null}
    </div>
  );
}
