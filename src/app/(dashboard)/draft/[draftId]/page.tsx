'use client';

/**
 * Full-page draft editor (bd 768w.16.9 follow-up).
 *
 * Promotes the draft editor from a cramped inline panel inside the topic drawer
 * to a first-tier dashboard route (/draft/<id>) so a full article is comfortable
 * to write. It renders inside the (dashboard) layout (sidebar + full-width main),
 * so the DocumentEditor lays out full width as the primary page content.
 *
 * The editor is CONTROLLED: this page owns the section values (via onChange) and
 * all persistence. The backend PATCH REPLACES the whole `data` blob (no deep
 * merge), so every write merges the section patch into the FULL existing
 * draft.data — never a partial — or untouched attributes would drop. "Mark ready"
 * flips the draft (chosen + ready) and its parent topic (written) together, then
 * navigates back to the content board.
 */
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, notify } from '@startsimpli/ui';
import {
  DocumentEditor,
  recordPatchFromSections,
  type DocSection,
} from '@startsimpli/ui/document-editor';

import { readData } from '@/lib/board';
import { CONTENT_TYPE_KEY, contentCategoryLabel, contentTabHref } from '@/lib/content';
import { draftJudgeVerdict, draftStatus, draftTitle } from '@/lib/topic-drafts';
import { getEntity, updateEntity, type EntityRecord } from '@/lib/foundry-api';

/** camelCase-aware read of a draft data value as a string. */
function draftStr(data: EntityRecord['data'], name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v);
}

/** Explicit document sections for a draft: blog/linkedin/seo/sources. */
function draftSections(draft: EntityRecord): DocSection[] {
  const seo = readData(draft.data, 'seo');
  const seoObj =
    seo && typeof seo === 'object' && !Array.isArray(seo) ? (seo as Record<string, unknown>) : {};
  const sourcesRaw = readData(draft.data, 'sources');
  const sources = Array.isArray(sourcesRaw)
    ? sourcesRaw.map((s) => (typeof s === 'string' ? s : String((s as Record<string, unknown>)?.url ?? s)))
    : typeof sourcesRaw === 'string'
      ? sourcesRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : [];
  return [
    { key: 'blog', label: 'Blog post', kind: 'markdown', value: draftStr(draft.data, 'blog') },
    { key: 'linkedin', label: 'LinkedIn post', kind: 'text', value: draftStr(draft.data, 'linkedin') },
    { key: 'seo', label: 'SEO', kind: 'structured', value: seoObj },
    { key: 'sources', label: 'Sources', kind: 'list', value: sources },
  ];
}

export default function DraftPage() {
  const params = useParams<{ draftId: string }>();
  const draftId = String(params.draftId);

  const draftQuery = useQuery({
    queryKey: ['entity', draftId],
    queryFn: () => getEntity(draftId),
  });

  if (draftQuery.isLoading) {
    return <p className="text-sm text-neutral-500">Loading draft…</p>;
  }
  if (draftQuery.isError || !draftQuery.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-500">Couldn’t load this draft.</p>
        <Link href={contentTabHref('')} className="text-sm text-neutral-600 underline">
          Back to the board
        </Link>
      </div>
    );
  }

  // Key by id so the editor's section state re-initializes if we ever navigate
  // between drafts without a full unmount.
  return <DraftEditorScreen key={draftQuery.data.id} draft={draftQuery.data} draftId={draftId} />;
}

function DraftEditorScreen({ draft, draftId }: { draft: EntityRecord; draftId: string }) {
  const qc = useQueryClient();
  const router = useRouter();

  const contentType = draftStr(draft.data, 'content_type');
  const backHref = contentTabHref(contentType);
  const topicRef = draftStr(draft.data, 'topic_ref');

  const topicQuery = useQuery({
    queryKey: ['entity', topicRef],
    queryFn: () => getEntity(topicRef),
    enabled: !!topicRef,
  });
  const topic = topicQuery.data ?? null;

  const [sections, setSections] = useState<DocSection[]>(() => draftSections(draft));
  const [marking, setMarking] = useState(false);
  const ready = draftStatus(draft) === 'ready';
  const verdict = draftJudgeVerdict(draft);

  const onChange = (key: string, value: unknown) =>
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));

  // Debounced autosave: PATCH the merged blob. No list invalidation here — the
  // DocumentEditor shows its own "Saved" pill, and refetching mid-edit would
  // churn the editor. markReady is what refreshes the board.
  async function save(next: DocSection[]) {
    const patch = recordPatchFromSections(next);
    await updateEntity(draft.id, { data: { ...draft.data, ...patch } });
  }

  async function markReady() {
    if (!topic) {
      notify.error('Still loading the parent topic — try again in a moment.');
      return;
    }
    setMarking(true);
    try {
      const patch = recordPatchFromSections(sections);
      // Save any pending edits and flip the draft to chosen+ready in one PATCH,
      // then move the topic to 'written'.
      await updateEntity(draft.id, {
        data: { ...draft.data, ...patch, chosen: true, status: 'ready' },
      });
      await updateEntity(topic.id, { data: { ...topic.data, status: 'written' } });
      await qc.invalidateQueries({ queryKey: ['entities', CONTENT_TYPE_KEY, 'all'] });
      notify.success('Marked ready.');
      router.push(backHref);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not mark ready.');
      setMarking(false);
    }
  }

  return (
    <div className="space-y-6 pb-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
          >
            ← Back to {contentCategoryLabel(contentType)} board
          </Link>
          <h1 className="truncate text-xl font-semibold">{draft.name || draftTitle(draft)}</h1>
          {topic ? (
            <p className="truncate text-sm text-neutral-500">
              Topic: {topic.name || draftTitle(topic)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {verdict ? (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs ${
                verdict === 'accept'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              judge: {verdict}
            </span>
          ) : null}
          {draftStatus(draft) ? (
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs capitalize text-neutral-600">
              {draftStatus(draft)}
            </span>
          ) : null}
        </div>
      </header>

      <DocumentEditor sections={sections} onChange={onChange} onSave={save} />

      {/* Prominent Mark-ready action: a sticky footer that stays reachable while
          scrolling a long article. Negative margins let its border span the full
          content width against the layout's gray background. */}
      <div className="sticky bottom-0 -mx-8 flex items-center justify-end gap-3 border-t border-neutral-200 bg-gray-50/95 px-8 py-3 backdrop-blur">
        <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-900">
          Cancel
        </Link>
        <Button onClick={markReady} disabled={marking || ready}>
          {ready ? 'Ready' : marking ? 'Marking…' : 'Mark ready'}
        </Button>
      </div>
    </div>
  );
}
