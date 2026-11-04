'use client';

/**
 * Research > one topic (bd startsim-cg3km): the documents behind it, one button,
 * and the content already made from it. Deliberately nothing else — no brief
 * field, no tick boxes, no "Work on this".
 */
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, notify } from '@startsimpli/ui';

import { plural } from '@/components/research/page-head';
import { getEntity, listEntities, listTypes, type EntityRecord } from '@/lib/foundry-api';
import { readData } from '@/lib/board';
import { startContent } from '@/lib/research/start-content';
import { documentLine, excerptOf, formatDay, topicSourceUrls, topicTitle } from '@/lib/research/topics';
import { draftTitle, fetchTopicDrafts } from '@/lib/topic-drafts';

const str = (v: unknown) => (v == null ? '' : String(v));

export default function ResearchTopicPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const topicQuery = useQuery({ queryKey: ['research', 'topic', topicId], queryFn: () => getEntity(topicId) });
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
  });

  if (topicQuery.isLoading) return <p className="text-sm text-neutral-500">Loading topic…</p>;
  if (topicQuery.isError || !topic) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-500">Couldn’t load this topic.</p>
        <Link href="/research/topics" className="text-sm text-neutral-600 underline">Topics</Link>
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

  async function onStart() {
    if (!topic || starting) return;
    setStarting(true);
    try {
      const { href } = await startContent(topic, typesQuery.data?.results.find((t) => t.key === 'topic'));
      router.push(href);
    } catch (err) {
      notify.error(err instanceof Error ? `Couldn’t start content: ${err.message}` : 'Couldn’t start content.');
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/research/topics" className="text-sm text-neutral-500 hover:text-neutral-800">← Topics</Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold text-neutral-900">{topicTitle(topic)}</h1>
          {angle ? <p className="text-sm text-neutral-500">{angle}</p> : null}
          <p className="text-xs text-neutral-500">
            {[plural(urls.length, 'source'), market, formatDay(topic.createdAt)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Button onClick={onStart} disabled={starting}>Start content</Button>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Documents in this topic</h2>
        {docsQuery.isLoading ? <p className="text-sm text-neutral-500">Loading documents…</p> : null}
        <ul className="divide-y divide-border">
          {found.map((d) => (
            <DocumentItem key={d.id} doc={d} />
          ))}
          {loose.map((u) => (
            <li key={u} className="py-3 text-sm">
              <a href={u} target="_blank" rel="noreferrer" className="text-neutral-700 underline">{u}</a>
            </li>
          ))}
        </ul>
        {docsQuery.isSuccess && found.length + loose.length === 0 ? (
          <p className="text-sm text-neutral-500">No documents are linked to this topic yet.</p>
        ) : null}
      </section>

      {drafts.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Content made from this topic</h2>
          <ul className="space-y-1">
            {drafts.map((d) => (
              <li key={d.id} className="text-sm">
                <Link href={`/draft/${d.id}`} className="text-neutral-800 underline">{draftTitle(d)}</Link>
              </li>
            ))}
          </ul>
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
    <li className="space-y-1 py-3">
      <a href={url || undefined} target="_blank" rel="noreferrer" className="text-sm font-medium text-neutral-900 underline">
        {title}
      </a>
      <p className="text-xs text-neutral-500">{documentLine(doc)}</p>
      {excerpt ? <blockquote className="border-l-2 border-border pl-3 text-sm text-neutral-700">“{excerpt}”</blockquote> : null}
    </li>
  );
}
