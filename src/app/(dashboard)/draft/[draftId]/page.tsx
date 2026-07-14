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
 * draft.data — never a partial — or untouched attributes would drop.
 *
 * Validate-before-accept (bd 768w.16.10.3): a live ValidationChecklist recomputes
 * the deterministic guardrail checks over the reviewer's EDITED sections (plus the
 * stored AI-judge verdict), and "Accept" is gated on those checks not failing —
 * unless the reviewer records a reasoned override. Accept flips the draft
 * (chosen + approved) and its parent topic (written) together; once approved, a
 * "Mark sent" hands off (status → sent, posting stays manual).
 */
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  notify,
  ValidationChecklist,
  runContentChecks,
  overallStatus,
  type JudgeVerdict,
  type ValidationOverride,
} from '@startsimpli/ui';
import {
  DocumentEditor,
  recordPatchFromSections,
  type DocSection,
} from '@startsimpli/ui/document-editor';

import { readData } from '@/lib/board';
import { CONTENT_TYPE_KEY, contentCategoryLabel, contentTabHref } from '@/lib/content';
import { draftJudgeVerdict, draftStatus, draftTitle } from '@/lib/topic-drafts';
import { contentFieldsFromSections, OGMC_APPROVED_HOSTS } from '@/lib/content-checks';
import { getEntity, updateEntity, type EntityRecord } from '@/lib/foundry-api';

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

  const [sections, setSections] = useState<DocSection[]>(() => draftSections(draft));
  const [override, setOverride] = useState<ValidationOverride>({ overridden: false });
  const [accepting, setAccepting] = useState(false);
  const [sending, setSending] = useState(false);

  const status = draftStatus(draft);
  const isApproved = status === 'approved';
  const isSent = status === 'sent';
  const verdict = draftJudgeVerdict(draft);
  const judgeVerdict = draftJudgeVerdictObj(draft);

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

  const onChange = (key: string, value: unknown) =>
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));

  // Debounced autosave: PATCH the merged blob. No list invalidation here — the
  // DocumentEditor shows its own "Saved" pill, and refetching mid-edit would
  // churn the editor. accept/markSent are what refresh the board.
  async function save(next: DocSection[]) {
    const patch = recordPatchFromSections(next);
    await updateEntity(draft.id, { data: { ...draft.data, ...patch } });
  }

  async function accept() {
    if (!canAccept) return; // defensive — the button is disabled in this state
    if (!topic) {
      notify.error('Still loading the parent topic — try again in a moment.');
      return;
    }
    setAccepting(true);
    try {
      const patch = recordPatchFromSections(sections);
      // Save pending edits and flip the draft to chosen+approved in one PATCH,
      // then move the topic to 'written'. Stamp the override reason when set.
      await updateEntity(draft.id, {
        data: {
          ...draft.data,
          ...patch,
          chosen: true,
          status: 'approved',
          ...(override.overridden ? { override_reason: override.reason } : {}),
        },
      });
      await updateEntity(topic.id, { data: { ...topic.data, status: 'written' } });
      // Refetch this draft (so the status pill + Mark-sent appear) and the board.
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
      const patch = recordPatchFromSections(sections);
      const sentAt = new Date().toISOString().slice(0, 10); // today, ISO date
      await updateEntity(draft.id, {
        data: { ...draft.data, ...patch, status: 'sent', sent_at: sentAt },
      });
      await qc.invalidateQueries({ queryKey: ['entity', draftId] });
      await qc.invalidateQueries({ queryKey: ['entities', CONTENT_TYPE_KEY, 'all'] });
      notify.success('Marked sent.');
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not mark sent.');
    } finally {
      setSending(false);
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

      <DocumentEditor sections={sections} onChange={onChange} onSave={save} />

      {/* Live validation: deterministic checks recomputed over the edited sections
          plus the stored AI-judge verdict. Gates Accept below. */}
      <ValidationChecklist
        checks={checks}
        judgeVerdict={judgeVerdict}
        override={override}
        onOverride={setOverride}
      />

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
