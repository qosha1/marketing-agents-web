'use client';

/**
 * Full-page draft editor (bd 768w.16.9 follow-up; reviewer-feedback + AI-revise
 * loop 768w.16.10.4/.5).
 *
 * Promotes the draft editor from a cramped inline panel inside the topic drawer
 * to a first-tier dashboard route (/draft/<id>) so a full article is comfortable
 * to write. It renders inside the (dashboard) layout (sidebar + full-width main),
 * so the DocumentEditor lays out full width as the primary page content.
 *
 * The editor is CONTROLLED: this page owns the section values (via onChange) and
 * ALL persistence. The backend PATCH REPLACES the whole `data` blob (no deep
 * merge), so every write goes through `mergedData()` — which merges the section
 * patch, the reviewer's scorecard (`review`) and section notes (`notes`) into the
 * FULL existing draft.data — never a partial — or untouched attributes would drop.
 * Refs mirror the latest local state so an async write (debounced review autosave,
 * a note add, Accept) always folds in the freshest of every field.
 *
 * Reviewer feedback (768w.16.10.4): a ReviewScorecard (verdict + per-guardrail
 * scores, autosaved debounced) and a ReviewNotes thread (section-scoped critique,
 * saved on add/resolve).
 *
 * AI revise loop (768w.16.10.5): "Request revision" compiles the scorecard + notes
 * into a critique and POSTs it to the n8n revise webhook (via /actions/request-
 * revision), which GPT-rewrites the draft into a NEW candidate stamped
 * `revised_from = <this draft id>`; the draft flips to `needs_revision` and we poll
 * the draft set until the new version appears. The "Revision history" affordance
 * lists the lineage, and — when this draft was itself revised from a parent — a
 * "Compare to previous" diff shows the parent blog against the current one.
 *
 * Validate-before-accept (bd 768w.16.10.3): a live ValidationChecklist recomputes
 * the deterministic guardrail checks over the reviewer's EDITED sections (plus the
 * stored AI-judge verdict), and "Accept" is gated on those checks not failing —
 * unless the reviewer records a reasoned override. Accept flips the draft
 * (chosen + approved) and its parent topic (written) together; once approved, a
 * "Mark sent" hands off (status → sent, posting stays manual).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  notify,
  ValidationChecklist,
  runContentChecks,
  overallStatus,
  ReviewScorecard,
  ReviewNotes,
  DEFAULT_REVIEW_DIMENSIONS,
  DiffViewer,
  type JudgeVerdict,
  type ValidationOverride,
  type ReviewScore,
  type ReviewNote,
} from '@startsimpli/ui';
import {
  DocumentEditor,
  recordPatchFromSections,
  type DocSection,
} from '@startsimpli/ui/document-editor';

import { readData } from '@/lib/board';
import { CONTENT_TYPE_KEY, contentCategoryLabel, contentTabHref } from '@/lib/content';
import { draftJudgeVerdict, draftStatus, draftTitle, DRAFT_TYPE } from '@/lib/topic-drafts';
import { contentFieldsFromSections, OGMC_APPROVED_HOSTS } from '@/lib/content-checks';
import {
  getEntity,
  listAllEntities,
  updateEntity,
  type EntityRecord,
} from '@/lib/foundry-api';
import { compileFeedback, readNotes, readReview, revisedFrom, revisionChain } from '@/lib/review';
import { unifiedBlogDiff } from '@/lib/blog-diff';

/** Status-pill tone per draft status (drafting → sent). */
const STATUS_PILL_TONE: Record<string, string> = {
  drafting: 'bg-neutral-100 text-neutral-600',
  ready: 'bg-amber-100 text-amber-700',
  needs_revision: 'bg-red-100 text-red-700',
  approved: 'bg-emerald-100 text-emerald-700',
  sent: 'bg-blue-100 text-blue-700',
};

/** The stored AI-judge verdict object, or undefined when absent/malformed. */
function draftJudgeVerdictObj(draft: EntityRecord): JudgeVerdict | undefined {
  const j = readData(draft.data, 'judge_verdict');
  return j && typeof j === 'object' && !Array.isArray(j) ? (j as JudgeVerdict) : undefined;
}

/** camelCase-aware read of a draft data value as a string. */
function draftStr(data: EntityRecord['data'], name: string): string {
  const v = readData(data, name);
  return v == null ? '' : String(v);
}

/** The current value of a section by key, or undefined when absent. */
function sectionValue(sections: DocSection[], key: string): unknown {
  return sections.find((s) => s.key === key)?.value;
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

  const contentType = draftStr(draft.data, 'content_type');
  const backHref = contentTabHref(contentType);
  const topicRef = draftStr(draft.data, 'topic_ref');

  const topicQuery = useQuery({
    queryKey: ['entity', topicRef],
    queryFn: () => getEntity(topicRef),
    enabled: !!topicRef,
  });
  const topic = topicQuery.data ?? null;
  const topicMarket = topic ? String(readData(topic.data, 'market') ?? '') : '';

  const [sections, setSections] = useState<DocSection[]>(() => draftSections(draft));
  const [review, setReview] = useState<ReviewScore>(() => readReview(draft.data));
  const [notes, setNotes] = useState<ReviewNote[]>(() => readNotes(draft.data));
  const [noteSection, setNoteSection] = useState<string>('general');
  const [override, setOverride] = useState<ValidationOverride>({ overridden: false });
  const [accepting, setAccepting] = useState(false);
  const [sending, setSending] = useState(false);
  const [revising, setRevising] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // Refs mirror the latest local state so any async persist merges the freshest of
  // every field (sections + review + notes) into the full data blob, regardless of
  // which one triggered the write.
  const sectionsRef = useRef(sections);
  const reviewRef = useRef(review);
  const notesRef = useRef(notes);
  // Sync the mirrors after each commit. Handlers that persist immediately also set
  // their own ref inline (below) so they never wait on this effect.
  useEffect(() => {
    sectionsRef.current = sections;
    reviewRef.current = review;
    notesRef.current = notes;
  });

  const reviewSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownChildIdsRef = useRef<Set<string>>(new Set());
  const notifiedReadyRef = useRef(false);

  const status = draftStatus(draft);
  const isApproved = status === 'approved';
  const isSent = status === 'sent';
  const verdict = draftJudgeVerdict(draft);
  const judgeVerdict = draftJudgeVerdictObj(draft);

  // The full draft set backs both the "Revision history" lineage and the revise
  // poll. It refetches on an interval only while a revision is in flight.
  const draftsQuery = useQuery({
    queryKey: ['entities', DRAFT_TYPE, 'all'],
    queryFn: () => listAllEntities(DRAFT_TYPE),
    refetchInterval: revising ? 8000 : false,
  });
  const allDrafts = useMemo(() => draftsQuery.data ?? [], [draftsQuery.data]);
  const chain = useMemo(() => revisionChain(draft, allDrafts), [draft, allDrafts]);
  const children = useMemo(
    () => allDrafts.filter((d) => revisedFrom(d) === String(draft.id)),
    [allDrafts, draft.id],
  );
  const latestChild = children.length
    ? children.reduce((a, b) => (a.id > b.id ? a : b))
    : null;
  const parentId = revisedFrom(draft);

  // Parent draft (for the "Compare to previous" blog diff) — fetched only when the
  // reviewer opens the diff on a revised draft.
  const parentQuery = useQuery({
    queryKey: ['entity', parentId],
    queryFn: () => getEntity(parentId),
    enabled: !!parentId && showDiff,
  });
  const parentBlog = parentQuery.data ? String(readData(parentQuery.data.data, 'blog') ?? '') : '';
  const thisBlog = String(sectionValue(sections, 'blog') ?? '');
  const blogDiff = useMemo(() => unifiedBlogDiff(parentBlog, thisBlog), [parentBlog, thisBlog]);

  // Recompute the deterministic guardrail checks over the CURRENT edited section
  // values (not stale draft.data) on every edit, so the checklist tracks live.
  const checks = useMemo(
    () => runContentChecks(contentFieldsFromSections(sections, draft.name), {
      approvedHosts: OGMC_APPROVED_HOSTS,
    }),
    [sections, draft.name],
  );

  // Accept is gated: allowed unless a check FAILS, or the reviewer recorded a
  // reasoned override.
  const overriddenWithReason =
    override.overridden && (override.reason ?? '').trim().length > 0;
  const canAccept = overallStatus(checks) !== 'fail' || overriddenWithReason;
  const failingLabels = checks.filter((c) => c.status === 'fail').map((c) => c.label);

  const feedbackReady = useMemo(
    () => compileFeedback(review, notes).trim().length > 0,
    [review, notes],
  );

  const onChange = (key: string, value: unknown) =>
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));

  // The single source of truth for a PATCH body: the full existing blob with the
  // freshest sections + review + notes folded in, plus any explicit status/flag
  // overrides. Every write below goes through this so nothing is ever dropped.
  const mergedData = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...draft.data,
    ...recordPatchFromSections(sectionsRef.current),
    review: reviewRef.current,
    notes: notesRef.current,
    ...overrides,
  });
  const persist = (overrides: Record<string, unknown> = {}) =>
    updateEntity(draft.id, { data: mergedData(overrides) });

  // Debounced autosave from the DocumentEditor. No list invalidation here — the
  // editor shows its own "Saved" pill, and refetching mid-edit would churn it.
  async function save(next: DocSection[]) {
    sectionsRef.current = next;
    await updateEntity(draft.id, { data: mergedData() });
  }

  // Scorecard autosave is debounced so per-keystroke note edits don't churn.
  function onReviewChange(next: ReviewScore) {
    setReview(next);
    reviewRef.current = next;
    if (reviewSaveTimer.current) clearTimeout(reviewSaveTimer.current);
    reviewSaveTimer.current = setTimeout(() => {
      persist().catch((err) =>
        notify.error(err instanceof Error ? err.message : 'Could not save the review.'),
      );
    }, 800);
  }

  function addNote(body: string) {
    const at = new Date().toISOString();
    const note: ReviewNote = {
      id: `${notesRef.current.length}-${at}`,
      body,
      section: noteSection,
      at,
    };
    const next = [...notesRef.current, note];
    setNotes(next);
    notesRef.current = next;
    persist().catch((err) =>
      notify.error(err instanceof Error ? err.message : 'Could not save the note.'),
    );
  }

  function resolveNote(id: string) {
    const next = notesRef.current.map((n) => (n.id === id ? { ...n, resolved: true } : n));
    setNotes(next);
    notesRef.current = next;
    persist().catch((err) =>
      notify.error(err instanceof Error ? err.message : 'Could not update the note.'),
    );
  }

  async function accept() {
    if (!canAccept) return; // defensive — the button is disabled in this state
    if (!topic) {
      notify.error('Still loading the parent topic — try again in a moment.');
      return;
    }
    setAccepting(true);
    try {
      // Save pending edits + review and flip the draft to chosen+approved in one
      // PATCH, then move the topic to 'written'. Stamp the override reason when set.
      await persist({
        chosen: true,
        status: 'approved',
        ...(override.overridden ? { override_reason: override.reason } : {}),
      });
      await updateEntity(topic.id, { data: { ...topic.data, status: 'written' } });
      await qc.invalidateQueries({ queryKey: ['entity', draftId] });
      await qc.invalidateQueries({ queryKey: ['entities', CONTENT_TYPE_KEY, 'all'] });
      notify.success('Accepted.');
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not accept.');
    } finally {
      setAccepting(false);
    }
  }

  async function markSent() {
    setSending(true);
    try {
      const sentAt = new Date().toISOString().slice(0, 10); // today, ISO date
      await persist({ status: 'sent', sent_at: sentAt });
      await qc.invalidateQueries({ queryKey: ['entity', draftId] });
      await qc.invalidateQueries({ queryKey: ['entities', CONTENT_TYPE_KEY, 'all'] });
      notify.success('Marked sent.');
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not mark sent.');
    } finally {
      setSending(false);
    }
  }

  // Compile the reviewer's critique and hand it to the n8n revise webhook, which
  // GPT-rewrites the draft into a NEW candidate (stamped revised_from = this id).
  // Flip this draft to needs_revision, then poll the draft set for the new version.
  async function requestRevision() {
    const feedback = compileFeedback(reviewRef.current, notesRef.current);
    if (!feedback.trim()) {
      notify.error('Add a scorecard note or a section note before requesting a revision.');
      return;
    }
    setRevising(true);
    knownChildIdsRef.current = new Set(children.map((c) => String(c.id)));
    notifiedReadyRef.current = false;
    try {
      const blog = String(sectionValue(sectionsRef.current, 'blog') ?? '');
      const linkedin = String(sectionValue(sectionsRef.current, 'linkedin') ?? '');
      const sourcesRaw = sectionValue(sectionsRef.current, 'sources');
      const sources = Array.isArray(sourcesRaw)
        ? sourcesRaw.map((s) => String(s)).join('\n')
        : String(sourcesRaw ?? '');

      const res = await fetch('/actions/request-revision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic_ref: draftStr(draft.data, 'topic_ref'),
          content_type: contentType,
          market: topicMarket,
          feedback,
          blog,
          linkedin,
          sources,
          parent_draft_id: String(draft.id),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Revise request failed (${res.status}).`);
      }
      // Mark this draft as awaiting a revision (full-blob merge preserves edits +
      // review + notes) and reflect the new status pill.
      await persist({ status: 'needs_revision' });
      await qc.invalidateQueries({ queryKey: ['entity', draftId] });
      notify.success('Revision requested — GPT is rewriting the draft (~1 min).');
      // Stop polling after ~90s even if nothing shows up.
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = setTimeout(() => setRevising(false), 90_000);
    } catch (err) {
      setRevising(false);
      notify.error(err instanceof Error ? err.message : 'Could not request a revision.');
    }
  }

  // When a fresh revision (a child id not present when we asked) appears while
  // polling, announce it and stop — the banner + history surface the link.
  useEffect(() => {
    if (!revising) return;
    const fresh = children.find((c) => !knownChildIdsRef.current.has(String(c.id)));
    if (fresh && !notifiedReadyRef.current) {
      notifiedReadyRef.current = true;
      setRevising(false);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      notify.success('A new revision is ready — open it below.');
    }
  }, [children, revising]);

  // Clear timers on unmount.
  useEffect(
    () => () => {
      if (reviewSaveTimer.current) clearTimeout(reviewSaveTimer.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    },
    [],
  );

  const noteSections = ['general', ...sections.map((s) => s.key)];

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
          {status ? (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs capitalize ${
                STATUS_PILL_TONE[status] ?? 'bg-neutral-100 text-neutral-600'
              }`}
            >
              {status.replace(/_/g, ' ')}
            </span>
          ) : null}
        </div>
      </header>

      {/* A newer revision was generated from this draft — surface a jump link. */}
      {latestChild ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span>A newer revision was generated from this draft.</span>
          <Link href={`/draft/${latestChild.id}`} className="font-medium underline">
            Open the latest revision →
          </Link>
        </div>
      ) : revising ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Revising… GPT is rewriting the draft (~1 min). The new version will appear here.
        </div>
      ) : null}

      <DocumentEditor sections={sections} onChange={onChange} onSave={save} />

      {/* Reviewer feedback: structured scorecard + section-scoped critique notes.
          The scorecard autosaves (debounced); notes save on add/resolve. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ReviewScorecard
          value={review}
          onChange={onReviewChange}
          dimensions={DEFAULT_REVIEW_DIMENSIONS}
          title="Reviewer scorecard"
        />
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            Note about
            <select
              value={noteSection}
              onChange={(e) => setNoteSection(e.target.value)}
              className="rounded-md border px-2 py-1 text-xs capitalize"
              aria-label="Section this note is about"
            >
              {noteSections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <ReviewNotes
            notes={notes}
            onAdd={addNote}
            onResolve={resolveNote}
            title="Section notes"
            emptyMessage="No section notes yet."
          />
        </div>
      </div>

      {/* Live validation: deterministic checks recomputed over the edited sections
          plus the stored AI-judge verdict. Gates Accept below. */}
      <ValidationChecklist
        checks={checks}
        judgeVerdict={judgeVerdict}
        override={override}
        onOverride={setOverride}
      />

      {/* Revision history + parent diff (only when this draft is part of a lineage). */}
      {chain.length > 1 || parentId ? (
        <section className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">Revision history</h3>
            {parentId ? (
              <button
                type="button"
                onClick={() => setShowDiff((v) => !v)}
                className="text-xs font-medium text-neutral-600 underline hover:text-neutral-900"
              >
                {showDiff ? 'Hide diff' : 'Compare to previous'}
              </button>
            ) : null}
          </div>
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {chain.map((d, i) => {
              const isCurrent = String(d.id) === String(draft.id);
              return (
                <li key={d.id} className="flex items-center gap-2">
                  {i > 0 ? <span className="text-neutral-300">→</span> : null}
                  {isCurrent ? (
                    <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white">
                      v{i + 1} (this)
                    </span>
                  ) : (
                    <Link
                      href={`/draft/${d.id}`}
                      className="rounded-full border px-2.5 py-0.5 text-xs text-neutral-600 hover:text-neutral-900"
                    >
                      v{i + 1}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
          {parentId && showDiff ? (
            <div className="h-[480px] overflow-hidden rounded-lg border">
              <DiffViewer
                diff={blogDiff}
                baseRef={`previous version (draft #${parentId})`}
                isLoading={parentQuery.isLoading}
                error={parentQuery.isError ? 'Could not load the previous version.' : null}
                onRefresh={() => parentQuery.refetch()}
                emptyLabel="No changes to the blog vs the previous version"
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Gated Accept + handoff: a sticky footer that stays reachable while
          scrolling a long article. Negative margins let its border span the full
          content width against the layout's gray background. */}
      <div className="sticky bottom-0 -mx-8 flex flex-wrap items-center justify-end gap-3 border-t border-neutral-200 bg-gray-50/95 px-8 py-3 backdrop-blur">
        {!canAccept && failingLabels.length > 0 ? (
          <span className="mr-auto text-xs text-red-600">
            Fix to accept: {failingLabels.join(', ')}
          </span>
        ) : null}
        <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-900">
          Cancel
        </Link>
        {!isApproved && !isSent ? (
          <Button
            variant="secondary"
            onClick={requestRevision}
            disabled={revising || accepting || !feedbackReady}
            title={feedbackReady ? undefined : 'Record scorecard or section feedback first'}
          >
            {revising ? 'Revising… (~1 min)' : 'Request revision'}
          </Button>
        ) : null}
        {isApproved || isSent ? (
          <Button variant="secondary" onClick={markSent} disabled={sending || isSent}>
            {isSent ? 'Sent' : sending ? 'Marking…' : 'Mark sent'}
          </Button>
        ) : (
          <Button onClick={accept} disabled={accepting || !canAccept}>
            {accepting ? 'Accepting…' : 'Accept'}
          </Button>
        )}
      </div>
    </div>
  );
}
