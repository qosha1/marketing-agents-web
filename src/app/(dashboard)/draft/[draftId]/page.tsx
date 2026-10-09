'use client';

/**
 * Full-page draft editor (bd 768w.16.9 follow-up; reviewer feedback
 * 768w.16.10.4; two-pane review redesign P1).
 *
 * Promotes the draft editor from a cramped inline panel inside the topic drawer
 * to a first-tier dashboard route (/draft/<id>) so a full article is comfortable
 * to write. It renders inside the (dashboard) layout (sidebar + full-width main).
 *
 * Two-pane layout (P1): the content pane (blog/LinkedIn/SEO/Sources) sits LEFT and
 * the History rail (who changed what, plus revision lineage) sits RIGHT; below
 * `lg` the rail stacks under the content. The presentational shell + rail + blog
 * card are fork-local (src/components/draft-review/*) pending extraction to a
 * shared composer — this page still owns ALL section state and persistence. The
 * blog and LinkedIn are under track changes (TrackedSection, bd startsim-q8sgy);
 * SEO stays in the shared DocumentEditor.
 *
 * REMOVED (bd startsim-m7fdm.25, Quinn 2026-10-08): the Checks / AI judge /
 * validation section ("it does nothing and is confusing and poorly designed"),
 * the "AI judge suggests" header pill, the Approve draft / Reject draft decision
 * with the checks gate and reasoned override on it, Notes, and their keyboard
 * shortcuts. Nothing stored was rewritten: `judge_verdict`, `review`, `notes` and
 * `override_reason` stay on every draft and ride through `mergedData()`
 * untouched. Topics still reach `written` through the n8n poll that marks any
 * ready topic with a draft. "Mark sent" stays for a draft that is approved.
 *
 * The editor is CONTROLLED: this page owns the section values (via onChange) and
 * ALL persistence. The backend PATCH REPLACES the whole `data` blob (no deep
 * merge), so every write goes through `mergedData()` — which merges the section
 * patch and sources into the FULL existing draft.data — never a partial — or
 * untouched attributes would drop. Refs mirror the latest local state so an
 * async write always folds in the freshest of every field.
 *
 * Revision lineage: the AI "Request revision" rewrite (768w.16.10.5) was removed
 * (bd startsim-whwxd.6), but drafts it already created still carry
 * `revised_from = <parent draft id>`. The "Revision history" affordance lists
 * that lineage, and — when this draft was revised from a parent — a "Compare to
 * previous" diff shows the parent blog against the current one.
 *
 * Conditional saves and the history (bd startsim-j19hf; server bd startsim-3c2wc /
 * bd startsim-o1qib). Every write from this page asserts the version it loaded, so
 * a save merged over a stale blob is REFUSED instead of destroying the other
 * reviewer's text — and the reviewer's own text stays on screen while they decide.
 * The three rules that matter here, because breaking any of them makes the guard a
 * decoration:
 *
 *   1. NOTHING ADOPTS `current_version` AND RETRIES. The hook holds the version and
 *      advances it only from a write that SUCCEEDED; re-sending at the version the
 *      refusal names is exactly the overwrite the 412 prevented. Only an explicit
 *      "Save mine anyway" does that, and a person has to press it.
 *   2. `save.paused` IS CHECKED BEFORE EVERY WRITE, and the debounced ones are the
 *      reason: the content editor autosaves at 1,200 ms, so an unguarded path
 *      would repaint the dialog per keystroke burst.
 *   3. `save()` REPORTS INSTEAD OF THROWING. Every call site below handles the
 *      result union, because a `{status: 'failed'}` never reaches a `.catch` and a
 *      500 would otherwise render as a success.
 *
 * It replaced `data._edit_history`, a log this page wrote INSIDE the blob the
 * backend replaces wholesale — so it lost entries in exactly the collision it
 * existed to record, and `human_edits` then held the log itself against machine
 * writes. The trail is server-side now and the panel in the rail is shared.
 *
 * Keyboard: [ / ] step the queue (lib/keyboard.ts). j/k (issues), a/x (decision)
 * and ? (legend) went with the sections they served.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Absence,
  Button,
  notify,
} from '@startsimpli/ui';
import {
  DocumentEditor,
  recordPatchFromSections,
  type DocSection,
} from '@startsimpli/ui/document-editor';
import {
  FieldAttribution,
  StaleSaveDialog,
  unifiedTextDiff,
  useConditionalSave,
  useFieldAuthors,
  type ConditionalSaveResult,
} from '@startsimpli/ui/history';

import { useAuth } from '@startsimpli/auth';

import { readData, typeRoute } from '@/lib/board';
import { wordCount } from '@startsimpli/ui';
import { CONTENT_TYPE_KEY } from '@/lib/content';
import { draftStatusLabel } from '@/lib/draft-status';
import {
  draftCandidateIndex,
  draftStatus,
  draftTitle,
  DRAFT_TYPE,
} from '@/lib/topic-drafts';
import { DraftReviewLayout } from '@/components/draft-review/DraftReviewLayout';
import {
  TopicBackLink,
  TopicContextHeader,
} from '@/components/draft-review/TopicContextHeader';
import { draftHref, FROM_PARAM, returnTarget, safeReturnPath } from '@/lib/story-nav';
import { HistoryRail } from '@/components/draft-review/HistoryRail';
import { LanguageSwitcher } from '@/components/draft-review/LanguageSwitcher';
import { TrackedSection } from '@/components/draft-review/TrackedSection';
import { ContentChannels } from '@/components/draft-review/ContentChannels';
import { SourcesTool } from '@/components/draft-review/SourcesTool';
import { approvedSourceBasis, approvedSourceGap, SOURCE_TYPE } from '@/lib/approved-sources';
import { isChannelId, type ChannelId } from '@/lib/draft-channels';
import { draftShortcut, shouldIgnoreShortcut } from '@/lib/keyboard';
import {
  entityWriteClient,
  getEntity,
  listAllEntities,
  listTypes,
  whoami,
  type EntityRecord,
} from '@/lib/foundry-api';
import {
  canEditRecord,
  foldAccepted,
  trackChangesClient,
  trackedText,
  withTrackedText,
} from '@/lib/track-changes';
import type { AcceptResponseWire } from '@startsimpli/ui/track-changes';
import { entityKey, primeEntity } from '@/lib/entity-cache';
import { fieldAuthorsClient, revisionClient } from '@/lib/revisions';
import { createWriteGate, restoreHooks } from '@/lib/restore-guard';
import { rememberVersion } from '@/lib/record-version';
import { actorEditsHref, renderNextLink } from '@/lib/activity-links';
import { revisedFrom, revisionChain } from '@/lib/review';
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

/**
 * Status-pill tone per draft status, over the team's six (bd startsim-wn2p.2):
 * the two review states are neutral/amber, approved is green, and the three
 * terminal dispositions share a muted red-to-grey band because they all mean
 * "this is not going out as it stands".
 *
 * A status the tenant declares but this map does not name falls back to neutral
 * rather than rendering untoned — membership is the schema's, not this file's.
 */
const STATUS_PILL_TONE: Record<string, string> = {
  ready_for_review: 'bg-neutral-100 text-neutral-600',
  under_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  // Published is the only state that is BOTH finished and still on the tracker,
  // so it gets its own tone rather than sharing approved's — a reviewer scanning
  // the list needs to see at a glance which approved pieces actually went out.
  published: 'bg-sky-100 text-sky-700',
  rejected: 'bg-red-100 text-red-700',
  not_for_publication: 'bg-neutral-200 text-neutral-700',
  for_repurpose: 'bg-violet-100 text-violet-700',
};

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

/**
 * Small word count for the channel-tab badges — the SHARED counter, not a local
 * one (bd startsim-wn2p.28).
 *
 * This was its own `split(/\s+/)`, so on the Chinese drafts the tab read
 * "Brief 16w" while the validation rail beside it read 524 words. Whitespace
 * counting sees only the Latin fragments embedded in Chinese prose.
 */
function words(s: string): number {
  return wordCount(s);
}


export default function DraftPage() {
  const params = useParams<{ draftId: string }>();
  const draftId = String(params.draftId);
  const qc = useQueryClient();

  const draftQuery = useQuery({
    queryKey: entityKey(draftId),
    queryFn: () => getEntity(draftId),
  });

  /**
   * Forces the editor to re-seed from the server's copy (bd startsim-j19hf).
   *
   * WHY A NONCE AND NOT A REFETCH. The screen seeds its section state once, from
   * `useState(() => draftSections(draft))`, and the `key` below is the record id —
   * which does not change when the SAME record is refetched. So a refetch alone
   * puts the new blob in the cache and leaves the reviewer looking at the old one
   * (the same mechanism lib/entity-cache.ts documents for invalidation). That is
   * harmless for an autosave and WRONG for "Discard my edits", which would
   * otherwise adopt the other person's version while still showing your own text:
   * a control that silently does nothing is worse than one that is not offered.
   *
   * Refetch FIRST, then remount — the other order remounts onto the stale blob.
   */
  const [reseed, setReseed] = useState(0);
  const reload = useCallback(async () => {
    await qc.refetchQueries({ queryKey: entityKey(draftId), exact: true });
    setReseed((n) => n + 1);
  }, [qc, draftId]);

  if (draftQuery.isLoading) {
    return <p className="text-sm text-neutral-500">Loading draft…</p>;
  }
  if (draftQuery.isError || !draftQuery.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-500">Couldn’t load this draft.</p>
        <Link href={`/board/${CONTENT_TYPE_KEY}`} className="text-sm text-neutral-600 underline">
          Back to the board
        </Link>
      </div>
    );
  }

  // Key by id so the editor's section state re-initializes if we ever navigate
  // between drafts without a full unmount — and by `reseed` so a deliberate
  // "load theirs" re-initializes it over the SAME record. See `reload`.
  return (
    <DraftEditorScreen
      key={`${draftQuery.data.id}:${reseed}`}
      draft={draftQuery.data}
      draftId={draftId}
      reload={reload}
    />
  );
}

function DraftEditorScreen({
  draft,
  draftId,
  reload,
}: {
  draft: EntityRecord;
  draftId: string;
  /** Refetch this record and re-seed the editor from it. See `DraftPage`. */
  reload: () => Promise<void>;
}) {
  const qc = useQueryClient();

  const contentType = draftStr(draft.data, 'content_type');
  const topicRef = draftStr(draft.data, 'topic_ref');

  const topicQuery = useQuery({
    queryKey: entityKey(topicRef),
    queryFn: () => getEntity(topicRef),
    enabled: !!topicRef,
  });
  const topic = topicQuery.data ?? null;

  // The content pane's channel is page state. Seed it from `?channel=` so the
  // shareable URL still opens the right tab — ContentChannels keeps writing the
  // param back on every switch.
  const searchParams = useSearchParams();
  const [channel, setChannel] = useState<ChannelId>(() => {
    const q = searchParams.get('channel');
    return isChannelId(q) ? q : 'brief';
  });
  // Below `lg` the History rail is stacked under the content, so opening History
  // from elsewhere (a field's "edited by" line, the stale-save dialog) has to
  // bring it into view or nothing visible happens. On `lg` it is already beside
  // the content, sticky, and scrolling would only yank the page.
  const railRef = useRef<HTMLDivElement | null>(null);
  const revealHistory = () => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches) return;
    requestAnimationFrame(() => railRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  // WHERE "BACK" GOES (bd startsim-z384k). The 2026-09-08 meeting asked for back
  // navigation to return to the TOPIC TABLE with its scope intact, so the
  // reviewer's own location rides along in `?from=` and is used verbatim when it
  // validates. Falling back to the content-kind table rather than to the board
  // is the meeting's answer; before this the link went to the BOARD.
  //
  // The label travels WITH the href, from one function, because startsim-uhmk
  // was exactly this link saying "... board" while pointing somewhere else.
  const back = useMemo(
    () => returnTarget(safeReturnPath(searchParams.get(FROM_PARAM)), contentType),
    [searchParams, contentType],
  );

  // The topic's own schema, for the context header's field map. Same ['types']
  // key as the translation query below, so it is one request either way.
  const schemaQuery = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });
  const topicType = (schemaQuery.data?.results ?? []).find((t) => t.key === CONTENT_TYPE_KEY);

  const [sections, setSections] = useState<DocSection[]>(() => draftSections(draft));
  /**
   * The blog and LinkedIn text AS STORED at the version the next write asserts
   * (bd startsim-q8sgy). Every track-changes offset describes this text, not
   * the reviewer's unsaved typing in `sections`. Moved by a save that landed
   * and by a track-changes accept, nothing else.
   */
  const [stored, setStored] = useState(() => trackedText(draft.data));
  const [sending, setSending] = useState(false);
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

  /** Whether the rail's History panel is open. Page state because the stale-save
   *  dialog's safe default action opens it. */
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The rail's History narrowed to one field (`?field=`), opened from a field's
   *  "edited by" line. Null shows every field. */
  const [historyField, setHistoryField] = useState<string | null>(null);

  // Refs mirror the latest local state so any async persist merges the freshest of
  // every field (sections + sources) into the full data blob,
  // regardless of which one triggered the write.
  const sectionsRef = useRef(sections);
  const sourceItemsRef = useRef(sourceItems);
  const sourceMetaRef = useRef(sourceMeta);
  // Sync the mirrors after each commit. Handlers that persist immediately also set
  // their own ref inline (below) so they never wait on this effect.
  useEffect(() => {
    sectionsRef.current = sections;
    sourceItemsRef.current = sourceItems;
    sourceMetaRef.current = sourceMeta;
  });

  const status = draftStatus(draft);
  const isApproved = status === 'approved';
  // "Sent" is no longer a status. The team's six (bd startsim-wn2p.2) have no
  // published state — their spreadsheet carries a Publication Date column
  // instead — so the fact that a piece went out lives where it always really
  // lived: the `sent_at` date stamped by `markSent`. Reading the date rather
  // than a status keeps the button honest without inventing a seventh value.
  // Whether a published STATUS should exist is open on bd startsim-wn2p.14.
  const isSent = draftStr(draft.data, 'sent_at').trim() !== '';

  // The full draft set backs the "Revision history" lineage and the review queue.
  const draftsQuery = useQuery({
    queryKey: ['entities', DRAFT_TYPE, 'all'],
    queryFn: () => listAllEntities(DRAFT_TYPE),
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
    // Carry the return path along the queue (bd startsim-z384k) — stepping to
    // the next draft must not quietly lose the table scope the reviewer came
    // from, or "back" lands somewhere they never were.
    if (d) router.push(draftHref(d.id, safeReturnPath(searchParams.get(FROM_PARAM))));
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
    queryKey: entityKey(parentId),
    queryFn: () => getEntity(parentId),
    enabled: !!parentId && showDiff,
  });
  const parentBlog = parentQuery.data ? String(readData(parentQuery.data.data, 'blog') ?? '') : '';
  const thisBlog = String(sectionValue(sections, 'blog') ?? '');
  // `blog.md` explicitly: the shared helper is generic over any record field and
  // defaults to `value.txt`, while the DiffViewer prints the path in its header
  // and this diff is a blog body.
  const blogDiff = useMemo(
    () => unifiedTextDiff(parentBlog, thisBlog, 'blog.md'),
    [parentBlog, thisBlog],
  );

  // THE APPROVED-SOURCE LIST IS TENANT DATA, not a constant (bd startsim-768w.18.14):
  // the team-editable Approved Source records decide which hosts the Sources tab
  // badges as approved. It no longer gates anything — the checks gate on Approve
  // went with the Checks section and the decision (bd startsim-m7fdm.25).
  //
  // An empty or failed read is an ABSENCE (bd startsim-4ipm): say so, and never
  // badge against some other list.
  const sourceRecordsQuery = useQuery({
    queryKey: ['entities', SOURCE_TYPE],
    queryFn: () => listAllEntities(SOURCE_TYPE),
  });
  const basis = useMemo(
    () =>
      approvedSourceBasis({
        records: sourceRecordsQuery.data,
        isPending: sourceRecordsQuery.isPending,
        isError: sourceRecordsQuery.isError,
      }),
    [sourceRecordsQuery.data, sourceRecordsQuery.isPending, sourceRecordsQuery.isError],
  );
  // Non-null exactly when there is no list to badge against — three states, three sentences.
  const sourceGap = approvedSourceGap(basis);
  // Where "Approved Source" lives in the nav: board or table, depending on whether
  // the tenant declared an enum on it. Ask the same helper the sidebar asks, so the
  // absence's action cannot send a reviewer somewhere the nav never goes.
  const sourceTypesQuery = useQuery({ queryKey: ['types'], queryFn: () => listTypes() });
  const sourceTypeDef = (sourceTypesQuery.data?.results ?? []).find((t) => t.key === SOURCE_TYPE);
  const sourceTypeRoute = sourceTypeDef ? typeRoute(sourceTypeDef) : `/t/${SOURCE_TYPE}`;

  /** Edits made vs edits saved, so a restore flushes only real unsaved typing
   *  (lib/restore-guard.ts). A counter, not a flag: typing during a save in
   *  flight must still count as unsaved when that save lands. */
  const editSeq = useRef(0);
  const savedSeq = useRef(0);
  const onChange = (key: string, value: unknown) => {
    editSeq.current += 1;
    return setSections((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
  };

  // The single source of truth for a PATCH body: the full existing blob with the
  // freshest sections + sources folded in, plus any explicit status/flag
  // overrides. Every write below goes through this so nothing is ever dropped —
  // including the stored `review`, `notes`, `judge_verdict` and `override_reason`
  // nothing on this page edits any more (bd startsim-m7fdm.25): they ride along
  // in `draft.data` untouched.
  //
  // IT NO LONGER STAMPS AN EDIT LOG (bd startsim-j19hf). It used to fold
  // `data._edit_history` in here, and the choke point was the right shape for
  // the wrong thing: a log that rides inside the blob the backend REPLACES
  // wholesale loses its entries in exactly the collision it exists to record,
  // and `human_edits` then holds the log itself against a machine write. The
  // trail is written server-side now, one row per write, and read back through
  // the History panel in the rail.
  const mergedData = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...draft.data,
    ...recordPatchFromSections(sectionsRef.current),
    // Sources are re-serialized to their ORIGINAL container so the pipeline reader
    // stays intact; unchanged rows round-trip verbatim. `sourceMeta` (camel — matches
    // the read shape so it overrides cleanly) carries the reviewer-only verified flags.
    sources: serializeSources(sourceItemsRef.current, sourcesContainer),
    sourceMeta: sourceMetaRef.current,
    ...overrides,
  });

  /**
   * THE WRITE. Every PATCH this page makes asserts the version the page loaded
   * (bd startsim-j19hf), and a refusal keeps the reviewer's text on screen.
   *
   * The hook holds the version: seeded from the record, advanced ONLY by a write
   * that succeeded, and never from the refusal — adopting `current_version` and
   * re-sending is the overwrite the 412 just prevented. The refused body is kept
   * on `conflict.refusedBody`, so the typed text survives even a reload of the
   * server's copy over the editor.
   */
  const writeClient = useMemo(() => entityWriteClient(draft.id), [draft.id]);
  const revisions = useMemo(() => revisionClient(draft.id), [draft.id]);
  const save = useConditionalSave({
    client: writeClient,
    // SEEDED, or the first save of the session is unguarded and the trail says so
    // (`precondition: "none"`). `?? undefined` and not `|| undefined`: version 0
    // is legitimate on every record that predates the trail.
    version: draft.version ?? undefined,
    // The 412 carries no identity by design, so the dialog reads the trail for
    // the human-readable half — the same client the panel takes.
    revisions,
  });

  /**
   * Report a save, in one place.
   *
   * `save()` RESOLVES on every outcome rather than throwing, which is the one
   * thing about this hook that can quietly break a call site: a `.catch` never
   * runs, so a 500 would render as a success and a refusal would look like a
   * save that landed. So nothing calls `save.save` directly — everything goes
   * through here, and every caller gets a boolean that means "it is on the
   * server".
   *
   * A REFUSAL IS NOT REPORTED AS AN ERROR. The dialog is already on screen
   * saying what happened and offering the three choices; a toast beside it would
   * be a second, worse account of the same event.
   */
  const report = (result: ConditionalSaveResult, whatFailed: string): boolean => {
    if (result.status === 'saved') {
      // The response is the freshest copy of this row that exists, and dropping
      // it left ['entity', <id>] holding the pre-edit blob for five minutes —
      // the reviewer reopened the draft and her edit was gone (bd
      // startsim-ug09d / startsim-mk5qp). See lib/entity-cache.ts.
      const saved = result.outcome.body as EntityRecord | undefined;
      if (saved?.id !== undefined) {
        primeEntity(qc, draft.id, saved);
        setStored(trackedText(saved.data));
      }
      return true;
    }
    if (result.status === 'failed') {
      const error = result.error;
      notify.error(error instanceof Error ? error.message : whatFailed);
    }
    if (result.status === 'paused') {
      // NOTHING WAS SENT, AND THE DIALOG MAY NOT BE ON SCREEN TO SAY SO.
      // Dismissing a conflict is deliberately not resolving it: Escape, the
      // backdrop and the close button all keep the pause. So after a dismissal
      // every write on this page is refused locally — a note added, a source
      // verified, Approve pressed — and without this it would be refused
      // SILENTLY, which is the one outcome worse than the overwrite this
      // feature exists to prevent. Re-opening puts the decision the reviewer
      // still owes back in front of them instead of a toast that explains
      // nothing.
      save.reopenConflict();
    }
    // 'refused' — the dialog is already on screen saying it.
    return false;
  };

  /**
   * EVERY WRITE GOES THROUGH THE GATE, so a restore can close it (bd
   * startsim-vehzd). While a restore is in flight the debounced editors may still
   * fire; through the gate they send nothing instead of PATCHing the old blob
   * back over the restored one. See lib/restore-guard.ts.
   */
  const gate = useMemo(() => createWriteGate(), []);
  const persist = (overrides: Record<string, unknown> = {}, whatFailed = 'Could not save.') =>
    gate.run(async () => {
      const seq = editSeq.current;
      const ok = report(await save.save({ data: mergedData(overrides) }), whatFailed);
      if (ok) savedSeq.current = Math.max(savedSeq.current, seq);
      return ok;
    }, false);

  /** The version a restore asserts: the hook's LIVE one, never `draft.version` —
   *  after one autosave the prop is stale and every restore would 412 against the
   *  reviewer's own save. A ref, because the flush just before a restore advances
   *  it inside the same tick, before React re-renders. */
  const liveVersion = useRef<number | undefined>(save.version);
  liveVersion.current = save.version ?? liveVersion.current;

  const restore = restoreHooks({
    gate,
    // Nothing on this page debounces outside the editors any more (the review
    // scorecard autosave went with the decision, bd startsim-m7fdm.25).
    cancelTimers: () => {},
    // What the editor holds NOW, straight through the conditional save (not the
    // gate it has just closed). A byte-identical re-send records nothing.
    hasUnsaved: () => editSeq.current > savedSeq.current,
    flush: async () => {
      const seq = editSeq.current;
      const result = await save.save({ data: mergedData() });
      if (result.status === 'saved') savedSeq.current = Math.max(savedSeq.current, seq);
      report(result, 'Could not save your latest edits.');
      if (result.status === 'saved' && result.version !== undefined) liveVersion.current = result.version;
      return result.status;
    },
    reload,
    remember: (record) => rememberVersion(draft.id, record),
  });

  /**
   * TRACK CHANGES (bd startsim-q8sgy). Who may edit is the account's role:
   * a viewer suggests and comments only (Quinn). The editor is not mounted
   * until that is known, so an editor never starts out held in suggesting.
   */
  const meQuery = useQuery({ queryKey: ['whoami'], queryFn: () => whoami(), staleTime: 5 * 60_000 });
  const me = meQuery.data;
  // THE RECORD'S OWN ANSWER (bd startsim-768w.71): a share on this draft or its
  // space decides, not the workspace role alone. The role is only the fallback
  // for a tenant that sends no permissions yet.
  const canEdit = canEditRecord(draft, me?.role);
  const tcClient = useMemo(() => trackChangesClient(draft.id), [draft.id]);
  // Until the role is known the editor is not mounted; a failed read says so
  // and offers a retry, rather than "Loading" for ever.
  const editorPending = meQuery.isError ? (
    <p className="text-sm text-muted-foreground">
      Could not check whether you may edit this draft.{' '}
      <button type="button" className="underline" onClick={() => void meQuery.refetch()}>
        Try again
      </button>
    </p>
  ) : (
    <p className="text-sm text-muted-foreground">Loading the editor…</p>
  );

  /**
   * An accept is a server-side write, so it is run like a restore: hold every
   * page write, flush only what was really typed, accept at the LIVE version,
   * then FOLD the answer into the page before any write can go out. Without
   * the fold the next scorecard autosave would PATCH the pre-accept text back
   * over it, at a version the accept already moved past.
   */
  const runAccept = async (doAccept: (expectedVersion: number) => Promise<AcceptResponseWire>) => {
    const release = await restore.beforeAccept();
    try {
      const at = liveVersion.current ?? save.version;
      if (at === undefined) throw new Error('This draft has no version yet, so nothing can be accepted.');
      const res = await doAccept(at);
      const folded = foldAccepted(res);
      const next = withTrackedText(sectionsRef.current, folded.text);
      sectionsRef.current = next;
      setSections(next);
      setStored(folded.text);
      if (folded.version !== undefined) {
        save.setVersion(folded.version);
        liveVersion.current = folded.version;
      }
      if (res.id !== undefined) primeEntity(qc, draft.id, res as unknown as EntityRecord);
      return res;
    } finally {
      release();
    }
  };

  /** Who last wrote each field. Keyed on the live version, so it re-reads after
   *  every save this page makes. */
  const authorsClient = useMemo(() => fieldAuthorsClient(draft.id), [draft.id]);
  const authors = useFieldAuthors({
    client: authorsClient,
    queryKey: [...entityKey(draft.id), 'field-authors', save.version ?? null],
  });
  const openFieldHistory = (field: string) => {
    setHistoryField(field);
    setHistoryOpen(true);
    revealHistory();
  };
  const attribution = (field: string, opts: { nameColumn?: boolean } = {}) => (
    <FieldAttribution
      authors={authors.data}
      field={field}
      {...(opts.nameColumn ? { nameColumn: true } : {})}
      onOpenHistory={openFieldHistory}
      actorHref={actorEditsHref}
      renderLink={renderNextLink}
    />
  );

  // Debounced autosave from the content editors. No list invalidation here — the
  // editors show their own "Saved" pill, and refetching mid-edit would churn it.
  // The DocumentEditor holds a SUBSET of the sections (the blog is edited in its
  // own TrackedSection, under track changes), so merge the
  // edited subset back into the full section ref rather than replacing it, or a
  // section would drop out of the ref and the next full-blob PATCH would lose it.
  async function saveSections(edited?: DocSection[]) {
    if (edited && edited.length) {
      sectionsRef.current = sectionsRef.current.map(
        (s) => edited.find((e) => e.key === s.key) ?? s,
      );
    }
    // NO `if (save.paused) return` HERE, AND THAT IS DELIBERATE — it was here and
    // it was the bug. The hook already refuses to send while a conflict is open,
    // so an early return bought nothing; what it cost was the report. Every
    // write would short-circuit before `report` saw `paused`, so after the
    // reviewer dismissed the dialog they could type for ten minutes into a page
    // that was saving nothing and saying nothing. The debounce still cannot
    // repaint a modal per keystroke: `reopenConflict` only clears a flag, so the
    // second burst and the hundredth are both no-ops against an open dialog.
    // NOTHING TYPED, NOTHING SENT (#96, bd startsim-q8sgy). An accepted
    // suggestion folds the server's text into the sections, which looks like a
    // change to the field's debounce; without this it would PATCH the whole
    // blob a second later and record a revision nobody made.
    if (editSeq.current === savedSeq.current) return;
    await persist({}, 'Could not save the draft.');
  }

  // Mirror the queue step so the key listener binds ONCE yet always calls the
  // freshest handler — the queue churns as drafts load. Synced after each commit,
  // like the persistence mirrors above.
  const queueByRef = useRef<(delta: 1 | -1) => void>(() => {});
  useEffect(() => {
    queueByRef.current = (delta) => goToDraft(delta === 1 ? nextDraft : prevDraft);
  });

  // [ / ] step the queue. Bound to the document because the reviewer's focus is
  // normally in the content pane — and guarded so a bracket typed into the blog
  // editor never leaves the draft (see shouldIgnoreShortcut).
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
      const action = draftShortcut(e.key);
      if (!action) return; // not ours — leave the event alone
      queueByRef.current(action.delta);
      e.preventDefault();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- Sources tool mutations (persist immediately via the full-blob merge) ---
  function persistSources(nextItems: ParsedSource[], nextMeta: SourceMetaEntry[]) {
    setSourceItems(nextItems);
    setSourceMeta(nextMeta);
    sourceItemsRef.current = nextItems;
    sourceMetaRef.current = nextMeta;
    void persist({}, 'Could not save sources.');
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

  async function markSent() {
    setSending(true);
    try {
      const sentAt = new Date().toISOString().slice(0, 10); // today, ISO date
      // Approved + a publication date, per the team's vocabulary: the status
      // says a human signed it off, `sent_at` says when it went out.
      if (!(await persist({ status: 'approved', sent_at: sentAt }, 'Could not mark sent.'))) {
        return;
      }
      await qc.invalidateQueries({ queryKey: ['entities', CONTENT_TYPE_KEY, 'all'] });
      notify.success('Marked sent.');
      goToDraft(nextDraft); // advance to the next draft in the queue
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not mark sent.');
    } finally {
      setSending(false);
    }
  }

  // Content is channel-tabbed (P2): Brief = the blog in its own TrackedSection (opens
  // in the editor, caret in the text — bd startsim-whwxd.17); LinkedIn + SEO render as single-section shared
  // DocumentEditors; Sources is the dedicated tool. Each channel edits the SAME
  // `sections`/sources state and persistence — no change to the stored data shape.
  const blogValue = String(sectionValue(sections, 'blog') ?? '');
  const linkedinValue = String(sectionValue(sections, 'linkedin') ?? '');
  const seoSection = useMemo(() => sections.filter((s) => s.key === 'seo'), [sections]);
  const sourcesCoverage = coverageSummary(sourceItems, today);

  // Header pills: status and candidate ordinal (# of N siblings
  // sharing this draft's topic).
  const candidateIndex = draftCandidateIndex(draft);
  const siblingCount = useMemo(
    () =>
      allDrafts.filter(
        (d) => topicRef && String(readData(d.data, 'topic_ref') ?? '') === topicRef,
      ).length,
    [allDrafts, topicRef],
  );

  // ONE PAGE, NO MODAL (bd startsim-z384k). The topic context a reviewer needs
  // while judging the draft — what the story was meant to be, which market and
  // kind it belongs to, and the note that asked for it — sits ABOVE the
  // workspace instead of in a drawer the reviewer had to leave behind. The
  // two-pane workspace below is untouched and keeps its full width, which is the
  // whole reason design gate startsim-w4txa chose full-page over a drawer.
  const header = (
    <div className="space-y-3">
      <TopicContextHeader
        topic={topic}
        type={topicType}
        backLink={<TopicBackLink href={back.href} label={back.label} />}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold">{draft.name || draftTitle(draft)}</h1>
        {attribution('name', { nameColumn: true })}
        <LanguageSwitcher draft={draft} canEdit={canEdit} />
      </div>
      <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
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
        {status ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              STATUS_PILL_TONE[status] ?? 'bg-neutral-100 text-neutral-600'
            }`}
          >
            {draftStatusLabel(status)}
          </span>
        ) : null}
        {status ? attribution('status') : null}
        {candidateIndex > 0 ? (
          <span className="rounded-full border border-border bg-neutral-50 px-2.5 py-0.5 text-xs text-neutral-500">
            candidate #{candidateIndex}
            {siblingCount > 1 ? ` of ${siblingCount}` : ''}
          </span>
        ) : null}
      </div>
      </div>
    </div>
  );

  const content = (
    <div className="space-y-4">
      {/* A newer revision was generated from this draft — surface a jump link. */}
      {latestChild ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span>A newer revision was generated from this draft.</span>
          <Link href={`/draft/${latestChild.id}`} className="font-medium underline">
            Open the latest revision →
          </Link>
        </div>
      ) : null}

      {/* One focused channel at a time — Brief default. */}
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
            // Opens in the editor with the caret in the text: zero clicks to type
            // (bd startsim-whwxd.17). Only the channel on screen takes focus.
            content: (
              <div className="space-y-2">
                {attribution('blog')}
                {me ? (
                  <TrackedSection
                    field="blog"
                    label="Blog post"
                    language="markdown"
                    value={blogValue}
                    stored={stored.blog}
                    version={save.version ?? null}
                    client={tcClient}
                    currentActorSub={me.sub}
                    canEdit={canEdit}
                    runAccept={runAccept}
                    autoFocus={channel === 'brief'}
                    onChange={(v) => onChange('blog', v)}
                    onSave={(v) => saveSections([{ key: 'blog', label: 'Blog post', kind: 'markdown', value: v }])}
                  />
                ) : (
                  editorPending
                )}
              </div>
            ),
          },
          {
            id: 'linkedin',
            label: 'LinkedIn',
            badge: linkedinValue ? `${words(linkedinValue)}w` : undefined,
            content: (
              <div className="space-y-2">
                {attribution('linkedin')}
                {me ? (
                  <TrackedSection
                    field="linkedin"
                    label="LinkedIn post"
                    language="plain"
                    value={linkedinValue}
                    stored={stored.linkedin}
                    version={save.version ?? null}
                    client={tcClient}
                    currentActorSub={me.sub}
                    canEdit={canEdit}
                    runAccept={runAccept}
                    autoFocus={channel === 'linkedin'}
                    onChange={(v) => onChange('linkedin', v)}
                    onSave={(v) => saveSections([{ key: 'linkedin', label: 'LinkedIn post', kind: 'text', value: v }])}
                  />
                ) : (
                  editorPending
                )}
              </div>
            ),
          },
          {
            id: 'seo',
            label: 'SEO',
            content: (
              <div className="space-y-2">
                {attribution('seo')}
                <DocumentEditor sections={seoSection} onChange={onChange} onSave={saveSections} />
              </div>
            ),
          },
          {
            id: 'sources',
            label: 'Sources',
            badge: `${sourceItems.length}`,
            warn: sourcesCoverage.concern,
            content: (
              <div className="space-y-3">
                {attribution('sources')}
                {/* The badges' basis, when there isn't one. Loading is a not-yet
                    (a quiet line); a genuine empty and a failed read are absences
                    with different fixes — so they are different cards, and neither
                    is a 0, a green tick or a verdict about this draft. */}
                {sourceGap ? (
                  basis.state === 'loading' ? (
                    <p className="text-sm text-muted-foreground">
                      {sourceGap.title} {sourceGap.description}
                    </p>
                  ) : (
                    <Absence
                      tier="card"
                      title={sourceGap.title}
                      description={sourceGap.description}
                      why="Which sources count as approved is decided by the tenant’s own Approved Source records. When that list is unavailable nothing is badged, rather than badged against a different list."
                      action={
                        sourceGap.retryable
                          ? {
                              label: 'Try again',
                              onClick: () => {
                                sourceRecordsQuery.refetch();
                              },
                            }
                          : {
                              label: 'Open Approved Source',
                              // typeRoute, not a literal: `source` declares an
                              // enum, so the sidebar sends people to /board/…
                              // and a hardcoded /t/… would land them somewhere
                              // the nav never goes.
                              onClick: () => router.push(sourceTypeRoute),
                            }
                      }
                    />
                  )
                ) : null}
                <SourcesTool
                  items={sourceItems}
                  verified={verifiedMap}
                  // null — NOT [] — when there is no basis: an empty allow-list
                  // would badge every row "unverified", which is a verdict we
                  // have not earned. The tool renders an absence instead.
                  approvedHosts={basis.state === 'ready' ? basis.hosts : null}
                  today={today}
                  onAdd={addSource}
                  onRemove={removeSource}
                  onToggleVerify={toggleVerify}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );

  const rail = (
    <HistoryRail
      canEdit={canEdit}
      revisions={revisions}
      historyOpen={historyOpen}
      onHistoryOpenChange={setHistoryOpen}
      historyField={historyField}
      onHistoryFieldChange={setHistoryField}
      // RESTORE (bd startsim-vehzd). The live version, read at confirm time; the
      // gate + flush before, and a refetch-and-remount after, so the editor's
      // local copy is the restored record and no queued autosave clobbers it.
      currentVersion={() => liveVersion.current}
      beforeRestore={restore.beforeRestore}
      onRestored={async (outcome) => {
        await restore.onRestored(outcome);
        notify.success(
          outcome.summary.revision === null
            ? 'Nothing to restore — the draft already matches that version.'
            : `Restored from v${outcome.summary.restoredFrom}.`,
        );
      }}
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

  // The bottom bar. The Approve draft / Reject draft decision that drove it was
  // removed (bd startsim-m7fdm.25), so it now shows only what is left to do:
  // "Mark sent" on a draft that is already approved (existing approvals, or one
  // moved to Approved on the board), and the view-only note for a reader who
  // cannot edit. Otherwise there is no bar.
  const decisionBar = !canEdit ? (
    <span className="text-xs text-neutral-500">You can view this draft: read, suggest and comment.</span>
  ) : isApproved || isSent ? (
    <>
      <span className="mr-auto" />
      <Button variant="secondary" onClick={markSent} disabled={sending || isSent}>
        {isSent ? 'Sent' : sending ? 'Marking…' : 'Mark sent'}
      </Button>
    </>
  ) : null;

  return (
    <>
      <DraftReviewLayout
        header={header}
        content={content}
        rail={rail}
        decisionBar={decisionBar}
        railRef={railRef}
      />
      {/* "Someone changed this while you were editing", and your text is still on
          screen behind it (bd startsim-jkkn7.3). Rendered OUTSIDE the layout,
          a sibling of it rather than a child of either pane.
          It needs no QueryClientProvider — deliberately, see the shared module. */}
      <StaleSaveDialog
        conflict={save.conflict}
        open={save.dialogOpen}
        recordLabel="this draft"
        busy={save.resolving}
        onDismiss={save.dismissConflict}
        // The ONLY path that adopts the version the refusal named. It re-sends
        // the refused body, so the reviewer's text is what lands.
        onKeepMine={() => {
          void save.keepMine().then((result) => {
            if (report(result, 'Could not save over their change.')) {
              notify.success('Saved — your version replaced theirs.');
            }
          });
        }}
        // Destructive to the local edit BY DESIGN, which is why it is the only
        // control here that is a link rather than a button. `reload` is what
        // makes it real: without the remount it would adopt their version and
        // leave your text on screen.
        onAcceptTheirs={() => {
          save.acceptTheirs();
          void reload();
        }}
        // The safe default action: show the trail rather than decide anything.
        onReviewChange={() => {
          setHistoryOpen(true);
          revealHistory();
          save.dismissConflict();
        }}
      />
    </>
  );
}
