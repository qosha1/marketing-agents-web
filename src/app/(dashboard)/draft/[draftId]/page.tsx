'use client';

/**
 * Full-page draft editor (bd 768w.16.9 follow-up; reviewer-feedback + AI-revise
 * loop 768w.16.10.4/.5; two-pane review redesign P1).
 *
 * Promotes the draft editor from a cramped inline panel inside the topic drawer
 * to a first-tier dashboard route (/draft/<id>) so a full article is comfortable
 * to write. It renders inside the (dashboard) layout (sidebar + full-width main).
 *
 * Two-pane layout (P1): the content pane (blog/LinkedIn/SEO/Sources) sits LEFT and
 * a Quality rail (validation + AI-judge + reviewer scorecard/notes + revision
 * history) sits RIGHT, over a pinned decision bar; below `lg` the rail drops under
 * the content behind a Content|Quality toggle. The presentational shell + rail +
 * blog card are fork-local (src/components/draft-review/*) pending extraction to a
 * shared composer — this page still owns ALL section state and persistence. The
 * blog opens in the rendered (Read) view by default (BlogSection); the remaining
 * sections stay in the shared DocumentEditor. Accept is gated on the deterministic
 * checks (with reasoned override) AND a human `approve` verdict — the AI judge is
 * advisory only and never blocks Accept.
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
 *
 * Jump-to-issue (P3, bd 768w.16.15.3): the checks now report WHERE they failed, so
 * this page owns the jump — the active channel + pane (both shells took an optional
 * controlled mode for it) and the active issue. The reviewer clicks an issue in the
 * rail (or presses j/k) and lands on the offending field with the text marked,
 * instead of decoding "Checks 7/8". a/r/x set the Decision from the keyboard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  notify,
  runContentChecks,
  overallStatus,
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
import {
  draftCandidateIndex,
  draftJudgeVerdict,
  draftStatus,
  draftTitle,
  DRAFT_TYPE,
} from '@/lib/topic-drafts';
import { DraftReviewLayout, type Pane } from '@/components/draft-review/DraftReviewLayout';
import { QualityRail } from '@/components/draft-review/QualityRail';
import { BlogSection } from '@/components/draft-review/BlogSection';
import { ContentChannels } from '@/components/draft-review/ContentChannels';
import { SourcesTool } from '@/components/draft-review/SourcesTool';
import { contentFieldsFromSections, OGMC_APPROVED_HOSTS } from '@/lib/content-checks';
import {
  findStopIndex,
  isChannelId,
  issueStops,
  nextStopIndex,
  prevStopIndex,
  stopIndexForCheck,
  type ChannelId,
  type StopKey,
} from '@/lib/issue-jump';
import { shouldIgnoreShortcut } from '@/lib/keyboard';
import {
  getEntity,
  listAllEntities,
  updateEntity,
  type EntityRecord,
} from '@/lib/foundry-api';
import { compileFeedback, readNotes, readReview, revisedFrom, revisionChain } from '@/lib/review';
import { unifiedBlogDiff } from '@/lib/blog-diff';
import {
  coverageSummary,
  parseSourceEntry,
  parseSources,
  serializeSources,
  type ParsedSource,
  type SourcesContainer,
} from '@/lib/sources';

/** A source's reviewer-only metadata (kept OUT of the `sources` string). */
interface SourceMetaEntry {
  id: string;
  verified: boolean;
}

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

/**
 * Editable document sections for a draft: blog/linkedin/seo. Sources are NOT a
 * DocumentEditor section anymore — they're the dedicated Sources channel tool
 * (parsed rows + format-preserving round-trip), so they're managed separately.
 */
function draftSections(draft: EntityRecord): DocSection[] {
  const seo = readData(draft.data, 'seo');
  const seoObj =
    seo && typeof seo === 'object' && !Array.isArray(seo) ? (seo as Record<string, unknown>) : {};
  return [
    { key: 'blog', label: 'Blog post', kind: 'markdown', value: draftStr(draft.data, 'blog') },
    { key: 'linkedin', label: 'LinkedIn post', kind: 'text', value: draftStr(draft.data, 'linkedin') },
    { key: 'seo', label: 'SEO', kind: 'structured', value: seoObj },
  ];
}

/** The reviewer's stored per-source metadata array ([] when absent). */
function readSourceMeta(data: EntityRecord['data'] | undefined): SourceMetaEntry[] {
  const m = readData(data, 'source_meta');
  return Array.isArray(m)
    ? (m as unknown[])
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({ id: String(e.id ?? ''), verified: !!e.verified }))
        .filter((e) => e.id)
    : [];
}

/** Small word count for the channel-tab badges. */
function words(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Stable "nothing to highlight" identity — keeps the paint effect from churning. */
const NO_MATCHES: string[] = [];

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

  // The content pane's channel + (narrow-only) visible pane are page state now that
  // jump-to-issue drives them. Seed the channel from `?channel=` so the shareable
  // URL still opens the right tab — ContentChannels can no longer do it for us once
  // it is controlled, and it keeps writing the param back on every switch.
  const searchParams = useSearchParams();
  const [channel, setChannel] = useState<ChannelId>(() => {
    const q = searchParams.get('channel');
    return isChannelId(q) ? q : 'brief';
  });
  const [pane, setPane] = useState<Pane>('content');

  const [sections, setSections] = useState<DocSection[]>(() => draftSections(draft));
  const [review, setReview] = useState<ReviewScore>(() => readReview(draft.data));
  const [notes, setNotes] = useState<ReviewNote[]>(() => readNotes(draft.data));
  const [noteSection, setNoteSection] = useState<string>('general');
  const [override, setOverride] = useState<ValidationOverride>({ overridden: false });
  const [accepting, setAccepting] = useState(false);
  const [sending, setSending] = useState(false);
  const [revising, setRevising] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // Sources are managed as parsed rows so the tool can show tier/recency, but the
  // stored `sources` value is round-tripped in its ORIGINAL container (string vs
  // array) so the n8n writer / other readers stay intact. The reviewer-only
  // `verified` flag rides a SEPARATE `source_meta` blob key.
  const sourcesContainer: SourcesContainer = useMemo(
    () => (Array.isArray(readData(draft.data, 'sources')) ? 'array' : 'string'),
    [draft.data],
  );
  const [sourceItems, setSourceItems] = useState<ParsedSource[]>(
    () => parseSources(readData(draft.data, 'sources')).items,
  );
  const [sourceMeta, setSourceMeta] = useState<SourceMetaEntry[]>(() => readSourceMeta(draft.data));
  const today = useMemo(() => new Date(), []);

  // Refs mirror the latest local state so any async persist merges the freshest of
  // every field (sections + review + notes + sources) into the full data blob,
  // regardless of which one triggered the write.
  const sectionsRef = useRef(sections);
  const reviewRef = useRef(review);
  const notesRef = useRef(notes);
  const sourceItemsRef = useRef(sourceItems);
  const sourceMetaRef = useRef(sourceMeta);
  // Sync the mirrors after each commit. Handlers that persist immediately also set
  // their own ref inline (below) so they never wait on this effect.
  useEffect(() => {
    sectionsRef.current = sections;
    reviewRef.current = review;
    notesRef.current = notes;
    sourceItemsRef.current = sourceItems;
    sourceMetaRef.current = sourceMeta;
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

  // Review QUEUE (same fast-review polish as the topic board): step through every
  // draft with prev/next + a counter, and AUTO-ADVANCE to the next after a decision,
  // so a reviewer rips through the publish queue instead of bouncing back to a table.
  const router = useRouter();
  const queueIndex = useMemo(
    () => allDrafts.findIndex((d) => String(d.id) === String(draftId)),
    [allDrafts, draftId],
  );
  const prevDraft = queueIndex > 0 ? allDrafts[queueIndex - 1] : null;
  const nextDraft =
    queueIndex >= 0 && queueIndex + 1 < allDrafts.length ? allDrafts[queueIndex + 1] : null;
  function goToDraft(d: EntityRecord | null) {
    if (d) router.push(`/draft/${d.id}`);
  }

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
  // Sources live outside `sections` now (they're the Sources tool), so re-inject a
  // synthetic sources section built from the tool's rows for the approved-sources
  // check.
  const checks = useMemo(() => {
    const sourcesSection: DocSection = {
      key: 'sources',
      label: 'Sources',
      kind: 'list',
      value: sourceItems.map((s) => s.url).filter(Boolean),
    };
    return runContentChecks(contentFieldsFromSections([...sections, sourcesSection], draft.name), {
      approvedHosts: OGMC_APPROVED_HOSTS,
    });
  }, [sections, sourceItems, draft.name]);

  // --- Jump-to-issue (bd 768w.16.15.3) ---
  // Every place a non-passing check can send the reviewer, rebuilt with the checks.
  const stops = useMemo(() => issueStops(checks), [checks]);

  // The active issue is held by IDENTITY, not by index: `stops` is rebuilt on every
  // keystroke, so a stored index would quietly come to point at a different issue
  // the moment one is fixed. Re-resolving means a fixed issue simply resolves to -1
  // and its highlight clears itself.
  const [activeKey, setActiveKey] = useState<StopKey | null>(null);
  const activeStop = useMemo(() => findStopIndex(stops, activeKey), [stops, activeKey]);
  const active = activeStop >= 0 ? stops[activeStop] : undefined;

  const [legendOpen, setLegendOpen] = useState(false);
  const contentPaneRef = useRef<HTMLDivElement | null>(null);

  // Accept gate (locked decision #2 — the human overrides the judge). Two
  // conditions, and the AI judge is NOT one of them (it's advisory / display-only):
  //   1. the deterministic ValidationChecklist checks don't FAIL — unless the
  //      reviewer records a reasoned override (unchanged); AND
  //   2. the reviewer has signed off: a human `approve` verdict on the scorecard.
  // A human `approve` unlocks Accept regardless of what the AI judge said.
  const overriddenWithReason =
    override.overridden && (override.reason ?? '').trim().length > 0;
  const validationOk = overallStatus(checks) !== 'fail' || overriddenWithReason;
  const reviewerSignedOff = review.verdict === 'approve';
  const canAccept = validationOk && reviewerSignedOff;
  const failingLabels = checks.filter((c) => c.status === 'fail').map((c) => c.label);

  // The gating hint on the left of the decision bar: fix failing checks first,
  // else prompt the reviewer to sign off. Null once Accept is unlocked.
  const acceptGateHint =
    !validationOk && failingLabels.length > 0
      ? `Fix to accept: ${failingLabels.join(', ')}`
      : validationOk && !reviewerSignedOff
        ? 'Set your verdict to Approve to accept'
        : null;

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
    // Sources are re-serialized to their ORIGINAL container so the pipeline reader
    // stays intact; unchanged rows round-trip verbatim. `sourceMeta` (camel — matches
    // the read shape so it overrides cleanly) carries the reviewer-only verified flags.
    sources: serializeSources(sourceItemsRef.current, sourcesContainer),
    sourceMeta: sourceMetaRef.current,
    review: reviewRef.current,
    notes: notesRef.current,
    ...overrides,
  });
  const persist = (overrides: Record<string, unknown> = {}) =>
    updateEntity(draft.id, { data: mergedData(overrides) });

  // Debounced autosave from the content editors. No list invalidation here — the
  // editors show their own "Saved" pill, and refetching mid-edit would churn it.
  // The DocumentEditor holds a SUBSET of the sections (the blog is edited in its
  // own BlogSection so it can open in Read — locked decision #3), so merge the
  // edited subset back into the full section ref rather than replacing it, or a
  // section would drop out of the ref and the next full-blob PATCH would lose it.
  async function save(edited?: DocSection[]) {
    if (edited && edited.length) {
      sectionsRef.current = sectionsRef.current.map(
        (s) => edited.find((e) => e.key === s.key) ?? s,
      );
    }
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

  // --- Jump-to-issue: the imperative half (bd 768w.16.15.3) ---
  // Below `onReviewChange` because the a/r/x shortcuts drive it.
  function goToStop(index: number) {
    const stop = stops[index];
    if (!stop) return; // nothing to jump to — never a dead click
    setActiveKey({ checkId: stop.checkId, field: stop.field });
    setChannel(stop.channel);
    // Below `lg` the panes are exclusive: a jump fired from the rail must reveal the
    // content it just switched to, or it lands on a hidden pane and looks broken.
    setPane('content');
    contentPaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Mirror the shortcut actions so the key listener binds ONCE yet always calls the
  // freshest handler — `stops`/`activeStop`/`review` all churn on every edit. Synced
  // after each commit, like the persistence mirrors above.
  const jumpByRef = useRef<(delta: 1 | -1) => void>(() => {});
  const setVerdictRef = useRef<(v: NonNullable<ReviewScore['verdict']>) => void>(() => {});
  const queueByRef = useRef<(delta: 1 | -1) => void>(() => {});
  useEffect(() => {
    jumpByRef.current = (delta) =>
      goToStop(
        delta === 1
          ? nextStopIndex(activeStop, stops.length)
          : prevStopIndex(activeStop, stops.length),
      );
    setVerdictRef.current = (v) => onReviewChange({ ...reviewRef.current, verdict: v });
    queueByRef.current = (delta) => goToDraft(delta === 1 ? nextDraft : prevDraft);
  });

  // j/k walk the issues; a/r/x set the Decision; ? toggles the legend. Bound to the
  // document because the reviewer's focus is normally in the content pane, not the
  // rail — and guarded so a letter typed into the feedback box or the blog editor
  // can never flip the verdict (see shouldIgnoreShortcut).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        shouldIgnoreShortcut({
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          target: e.target,
        })
      ) {
        return;
      }
      switch (e.key) {
        case 'j':
          jumpByRef.current(1);
          break;
        case 'k':
          jumpByRef.current(-1);
          break;
        case 'a':
          setVerdictRef.current('approve');
          break;
        case 'r':
          setVerdictRef.current('revise');
          break;
        case 'x':
          setVerdictRef.current('reject');
          break;
        case ']':
          queueByRef.current(1); // next draft in the queue
          break;
        case '[':
          queueByRef.current(-1); // previous draft in the queue
          break;
        case '?':
          setLegendOpen((v) => !v);
          break;
        default:
          return; // not ours — leave the event alone
      }
      e.preventDefault();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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

  // --- Sources tool mutations (persist immediately via the full-blob merge) ---
  function persistSources(nextItems: ParsedSource[], nextMeta: SourceMetaEntry[]) {
    setSourceItems(nextItems);
    setSourceMeta(nextMeta);
    sourceItemsRef.current = nextItems;
    sourceMetaRef.current = nextMeta;
    persist().catch((err) =>
      notify.error(err instanceof Error ? err.message : 'Could not save sources.'),
    );
  }

  function addSource(url: string) {
    const clean = url.trim();
    if (!clean) return;
    // A bare URL parses with raw=<url> (publisher=host, no date), so it serializes
    // verbatim — appended cleanly to the stored `sources` in its original shape.
    const parsed = parseSourceEntry(clean);
    if (sourceItemsRef.current.some((s) => s.id === parsed.id)) return; // dedupe
    persistSources([...sourceItemsRef.current, parsed], sourceMetaRef.current);
  }

  function removeSource(id: string) {
    persistSources(
      sourceItemsRef.current.filter((s) => s.id !== id),
      sourceMetaRef.current.filter((m) => m.id !== id),
    );
  }

  function toggleVerify(id: string) {
    const existing = sourceMetaRef.current.find((m) => m.id === id);
    const nextMeta = existing
      ? sourceMetaRef.current.map((m) => (m.id === id ? { ...m, verified: !m.verified } : m))
      : [...sourceMetaRef.current, { id, verified: true }];
    persistSources(sourceItemsRef.current, nextMeta);
  }

  const verifiedMap = useMemo(
    () => Object.fromEntries(sourceMeta.map((m) => [m.id, m.verified])),
    [sourceMeta],
  );

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
      goToDraft(nextDraft); // advance to the next draft in the queue
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
      goToDraft(nextDraft); // advance to the next draft in the queue
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not mark sent.');
    } finally {
      setSending(false);
    }
  }

  // Reject this candidate. There's no draft 'rejected' status in the enum, so do the
  // minimal correct thing: record the reject verdict (already set on `review` via
  // the Decision control) and mark the candidate not-chosen (`chosen: false`) — its sibling
  // drafts stay available. No new lifecycle invented.
  async function reject() {
    setRejecting(true);
    try {
      await persist({ chosen: false });
      await qc.invalidateQueries({ queryKey: ['entity', draftId] });
      await qc.invalidateQueries({ queryKey: ['entities', CONTENT_TYPE_KEY, 'all'] });
      notify.success('Candidate rejected.');
      goToDraft(nextDraft); // advance to the next draft in the queue
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not reject.');
    } finally {
      setRejecting(false);
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
      // Sources now live in the Sources tool — hand the rewriter the same newline
      // text it always got (each row's original entry line).
      const sources = sourceItemsRef.current
        .map((s) => (s.raw?.trim() ? s.raw.trim() : s.url))
        .filter(Boolean)
        .join('\n');

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

  const noteSections = ['general', 'blog', 'linkedin', 'seo', 'sources'];

  // Content is channel-tabbed (P2): Brief = the blog in its own BlogSection (opens
  // in Read — locked decision #3); LinkedIn + SEO render as single-section shared
  // DocumentEditors; Sources is the dedicated tool. Each channel edits the SAME
  // `sections`/sources state and persistence — no change to the stored data shape.
  const blogValue = String(sectionValue(sections, 'blog') ?? '');
  const linkedinValue = String(sectionValue(sections, 'linkedin') ?? '');
  const linkedinSection = useMemo(
    () => sections.filter((s) => s.key === 'linkedin'),
    [sections],
  );
  const seoSection = useMemo(() => sections.filter((s) => s.key === 'seo'), [sections]);
  const sourcesCoverage = coverageSummary(sourceItems, today);

  // What the active jump wants marked, per channel. Only the blog (hype words) and
  // the sources (unapproved URLs) can actually render a mark: LinkedIn + SEO are
  // textareas/inputs with no text nodes to paint, and the headline lives in the page
  // header, outside the channels. Those jumps still switch + scroll — see the bead.
  const blogHighlight = active?.field === 'blog' ? active.matches : NO_MATCHES;
  const flaggedSources = active?.field === 'sources' ? active.matches : NO_MATCHES;

  // Header pills: AI-judge verdict, status, and candidate ordinal (# of N siblings
  // sharing this draft's topic).
  const candidateIndex = draftCandidateIndex(draft);
  const siblingCount = useMemo(
    () =>
      allDrafts.filter(
        (d) => topicRef && String(readData(d.data, 'topic_ref') ?? '') === topicRef,
      ).length,
    [allDrafts, topicRef],
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to {contentCategoryLabel(contentType)} board
        </Link>
        <h1 className="text-xl font-semibold">{draft.name || draftTitle(draft)}</h1>
        {topic ? (
          <p className="truncate text-sm text-neutral-500">
            Topic: {topic.name || draftTitle(topic)}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {allDrafts.length > 0 && queueIndex >= 0 ? (
          <div className="flex items-center gap-1 rounded-md border border-border bg-neutral-50 px-1 text-xs text-neutral-500">
            <button
              onClick={() => goToDraft(prevDraft)}
              disabled={!prevDraft}
              className="rounded p-1 hover:bg-neutral-200 disabled:opacity-30"
              aria-label="Previous draft"
              title="Previous draft ( [ )"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums">
              {queueIndex + 1} / {allDrafts.length}
            </span>
            <button
              onClick={() => goToDraft(nextDraft)}
              disabled={!nextDraft}
              className="rounded p-1 hover:bg-neutral-200 disabled:opacity-30"
              aria-label="Next draft"
              title="Next draft ( ] )"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {verdict ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              verdict === 'accept'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            AI judge suggests: {verdict}
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
        {candidateIndex > 0 ? (
          <span className="rounded-full border border-border bg-neutral-50 px-2.5 py-0.5 text-xs text-neutral-500">
            candidate #{candidateIndex}
            {siblingCount > 1 ? ` of ${siblingCount}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );

  // A jump scrolls this container into view — the pane is the target the checks can
  // always name, whether or not the finding has a span to mark inside it.
  const content = (
    <div ref={contentPaneRef} className="space-y-4">
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

      {/* One focused channel at a time — Brief default. Controlled so the rail's
          jump-to-issue can open the channel holding a failing check. */}
      <ContentChannels
        active={channel}
        onActiveChange={(id) => {
          if (isChannelId(id)) setChannel(id);
        }}
        channels={[
          {
            id: 'brief',
            label: 'Brief',
            badge: blogValue ? `${words(blogValue)}w` : undefined,
            // Blog opens in the rendered (Read) view by default (locked decision #3).
            content: (
              <BlogSection
                value={blogValue}
                highlight={blogHighlight}
                onChange={(v) => onChange('blog', v)}
                onSave={(v) => save([{ key: 'blog', label: 'Blog post', kind: 'markdown', value: v }])}
              />
            ),
          },
          {
            id: 'linkedin',
            label: 'LinkedIn',
            badge: linkedinValue ? `${words(linkedinValue)}w` : undefined,
            content: <DocumentEditor sections={linkedinSection} onChange={onChange} onSave={save} />,
          },
          {
            id: 'seo',
            label: 'SEO',
            content: <DocumentEditor sections={seoSection} onChange={onChange} onSave={save} />,
          },
          {
            id: 'sources',
            label: 'Sources',
            badge: `${sourceItems.length}`,
            warn: sourcesCoverage.concern,
            content: (
              <SourcesTool
                items={sourceItems}
                verified={verifiedMap}
                approvedHosts={OGMC_APPROVED_HOSTS}
                today={today}
                judgeVerdict={judgeVerdict}
                flagged={flaggedSources}
                onAdd={addSource}
                onRemove={removeSource}
                onToggleVerify={toggleVerify}
              />
            ),
          },
        ]}
      />
    </div>
  );

  const rail = (
    <QualityRail
      checks={checks}
      stops={stops}
      activeStop={activeStop}
      onJumpToCheck={(checkId) => goToStop(stopIndexForCheck(stops, checkId, activeStop))}
      legendOpen={legendOpen}
      onToggleLegend={() => setLegendOpen((v) => !v)}
      judgeVerdict={judgeVerdict}
      judgeVerdictWord={verdict}
      override={override}
      onOverride={setOverride}
      review={review}
      onReviewChange={onReviewChange}
      feedbackReady={feedbackReady}
      canAccept={canAccept}
      acceptGateHint={acceptGateHint}
      notes={notes}
      onAddNote={addNote}
      onResolveNote={resolveNote}
      noteSection={noteSection}
      onNoteSectionChange={setNoteSection}
      noteSections={noteSections}
      chain={chain}
      currentId={String(draft.id)}
      parentId={parentId}
      showDiff={showDiff}
      onToggleDiff={() => setShowDiff((v) => !v)}
      blogDiff={blogDiff}
      parentLoading={parentQuery.isLoading}
      parentError={parentQuery.isError}
      onRefreshParent={() => parentQuery.refetch()}
    />
  );

  // The decision bar reflects the rail's "Decision" (locked decision #2): ONE primary
  // action driven by the reviewer's verdict. approve → Accept (gated), revise → Request
  // revision (needs feedback), reject → Reject, none → disabled "Choose a decision".
  const call = review.verdict;
  const gateText = isApproved || isSent
    ? null
    : !call
      ? 'Choose a decision'
      : call === 'approve'
        ? acceptGateHint ?? 'Ready to accept'
        : call === 'revise'
          ? feedbackReady
            ? 'Feedback ready'
            : 'Describe the changes to enable Request revision'
          : 'This candidate will be dropped';
  const gateWarn =
    call === 'approve' ? !validationOk : call === 'revise' ? !feedbackReady : false;

  const primaryAction = () => {
    if (call === 'approve') return accept();
    if (call === 'revise') return requestRevision();
    if (call === 'reject') return reject();
  };
  const primaryLabel =
    call === 'approve'
      ? accepting
        ? 'Accepting…'
        : 'Accept'
      : call === 'revise'
        ? revising
          ? 'Revising… (~1 min)'
          : 'Request revision'
        : call === 'reject'
          ? rejecting
            ? 'Rejecting…'
            : 'Reject'
          : 'Choose a decision';
  const primaryDisabled =
    !call ||
    accepting ||
    revising ||
    rejecting ||
    (call === 'approve' && !canAccept) ||
    (call === 'revise' && !feedbackReady);
  const primaryVariant = call === 'reject' ? 'destructive' : call === 'revise' ? 'secondary' : 'default';

  const decisionBar = (
    <>
      {gateText ? (
        <span className={`mr-auto text-xs ${gateWarn ? 'text-amber-700' : 'text-neutral-500'}`}>
          {gateText}
        </span>
      ) : (
        <span className="mr-auto" />
      )}
      <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-900">
        Cancel
      </Link>
      {isApproved || isSent ? (
        <Button variant="secondary" onClick={markSent} disabled={sending || isSent}>
          {isSent ? 'Sent' : sending ? 'Marking…' : 'Mark sent'}
        </Button>
      ) : (
        <Button
          variant={primaryVariant}
          onClick={primaryAction}
          disabled={primaryDisabled}
          title={call ? undefined : 'Pick Approve, Request changes, or Reject in the rail'}
        >
          {primaryLabel}
        </Button>
      )}
    </>
  );

  return (
    <DraftReviewLayout
      header={header}
      content={content}
      rail={rail}
      decisionBar={decisionBar}
      pane={pane}
      onPaneChange={setPane}
    />
  );
}
