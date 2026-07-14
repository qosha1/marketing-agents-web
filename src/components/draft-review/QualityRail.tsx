'use client';

/**
 * QualityRail — the right-hand quality rail of the two-pane draft review (P1).
 *
 * A one-line quality summary (Checks x/n · AI judge · Your call) over three
 * collapsible panels, in order: Validation (the shared ValidationChecklist, which
 * carries the AI-judge block — kept intact), Your review (ReviewScorecard + a
 * section-scoped ReviewNotes thread), and Revision history (lineage chips + an
 * on-demand blog diff). The shared primitives are flattened into each panel so the
 * panel supplies the single card + title; every primitive stays otherwise intact.
 * Presentational — all state + persistence stay in the draft page. Fork-local for
 * now; extracted to a shared composer once the design is confirmed.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  ValidationChecklist,
  ReviewScorecard,
  ReviewNotes,
  DiffViewer,
  DEFAULT_REVIEW_DIMENSIONS,
  overallStatus,
  type ContentCheck,
  type JudgeVerdict,
  type ValidationOverride,
  type ReviewScore,
  type ReviewNote,
  type CheckStatus,
} from '@startsimpli/ui';

import { cn } from '@startsimpli/ui/utils';
import type { EntityRecord } from '@/lib/foundry-api';
import { CollapsiblePanel, FLATTEN_CARD } from './CollapsiblePanel';

export interface QualityRailProps {
  // Summary + Validation
  checks: ContentCheck[];
  judgeVerdict?: JudgeVerdict;
  /** The stored AI-judge verdict word (display-only in the summary). */
  judgeVerdictWord: string;
  override: ValidationOverride;
  onOverride: (next: ValidationOverride) => void;

  // Your review
  review: ReviewScore;
  onReviewChange: (next: ReviewScore) => void;
  notes: ReviewNote[];
  onAddNote: (body: string) => void;
  onResolveNote: (id: string) => void;
  noteSection: string;
  onNoteSectionChange: (section: string) => void;
  noteSections: string[];

  // Revision history
  chain: EntityRecord[];
  currentId: string;
  parentId: string;
  showDiff: boolean;
  onToggleDiff: () => void;
  blogDiff: string;
  parentLoading: boolean;
  parentError: boolean;
  onRefreshParent: () => void;
}

const CHECK_TONE_TEXT: Record<CheckStatus, string> = {
  pass: 'text-emerald-700',
  warn: 'text-amber-700',
  fail: 'text-red-700',
};

const VERDICT_TEXT: Record<NonNullable<ReviewScore['verdict']>, string> = {
  approve: 'text-emerald-700',
  revise: 'text-amber-700',
  reject: 'text-red-700',
};

function judgeTone(word: string): string {
  const v = word.toLowerCase();
  if (/pass|approve|accept|ok|good/.test(v)) return 'text-emerald-700';
  if (/fail|reject|block|deny|bad/.test(v)) return 'text-red-700';
  if (!v) return 'text-neutral-400';
  return 'text-amber-700';
}

export function QualityRail(props: QualityRailProps) {
  const {
    checks,
    judgeVerdict,
    judgeVerdictWord,
    override,
    onOverride,
    review,
    onReviewChange,
    notes,
    onAddNote,
    onResolveNote,
    noteSection,
    onNoteSectionChange,
    noteSections,
    chain,
    currentId,
    parentId,
    showDiff,
    onToggleDiff,
    blogDiff,
    parentLoading,
    parentError,
    onRefreshParent,
  } = props;

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const total = checks.length;
  const overall = overallStatus(checks);
  const checksTone = override.overridden ? 'text-emerald-700' : CHECK_TONE_TEXT[overall];
  const reviewVerdict = review.verdict;
  const currentVersion = Math.max(1, chain.findIndex((d) => String(d.id) === currentId) + 1);
  const hasHistory = chain.length > 1 || !!parentId;

  return (
    <div className="flex flex-col gap-3">
      {/* One-line quality summary */}
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-card">
        <SummaryCell label="Checks" value={total ? `${passCount}/${total}` : '—'} tone={total ? checksTone : 'text-neutral-400'} />
        <SummaryCell label="AI judge" value={judgeVerdictWord || '—'} tone={judgeTone(judgeVerdictWord)} border />
        <SummaryCell
          label="Your call"
          value={reviewVerdict || '—'}
          tone={reviewVerdict ? VERDICT_TEXT[reviewVerdict] : 'text-neutral-400'}
          border
        />
      </div>

      {/* Validation (deterministic checks + AI-judge block) — kept intact. */}
      <CollapsiblePanel
        title="Validation"
        defaultOpen
        badge={
          <span className={cn('font-mono text-xs', total ? checksTone : 'text-neutral-400')}>
            {total ? `${passCount}/${total}` : '—'}
          </span>
        }
      >
        <ValidationChecklist
          checks={checks}
          judgeVerdict={judgeVerdict}
          override={override}
          onOverride={onOverride}
          title=""
          className={FLATTEN_CARD}
        />
      </CollapsiblePanel>

      {/* Your review — scorecard + section-scoped notes. */}
      <CollapsiblePanel
        title="Your review"
        defaultOpen
        badge={
          <span className={cn('text-xs font-medium capitalize', reviewVerdict ? VERDICT_TEXT[reviewVerdict] : 'text-neutral-400')}>
            {reviewVerdict ?? 'not set'}
          </span>
        }
      >
        <div className="space-y-4">
          <ReviewScorecard
            value={review}
            onChange={onReviewChange}
            dimensions={DEFAULT_REVIEW_DIMENSIONS}
            title=""
            className={FLATTEN_CARD}
          />
          <div className="space-y-2 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              Note about
              <select
                value={noteSection}
                onChange={(e) => onNoteSectionChange(e.target.value)}
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
              onAdd={onAddNote}
              onResolve={onResolveNote}
              title=""
              emptyMessage="No section notes yet."
              className={FLATTEN_CARD}
            />
          </div>
        </div>
      </CollapsiblePanel>

      {/* Revision history — lineage chips + on-demand blog diff. */}
      {hasHistory ? (
        <CollapsiblePanel
          title="Revision history"
          badge={<span className="font-mono text-xs text-neutral-500">v{currentVersion}</span>}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ol className="flex flex-wrap items-center gap-2 text-sm">
                {chain.map((d, i) => {
                  const isCurrent = String(d.id) === currentId;
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
              {parentId ? (
                <button
                  type="button"
                  onClick={onToggleDiff}
                  className="text-xs font-medium text-neutral-600 underline hover:text-neutral-900"
                >
                  {showDiff ? 'Hide diff' : 'Compare to previous'}
                </button>
              ) : null}
            </div>
            {parentId && showDiff ? (
              <div className="h-[420px] overflow-hidden rounded-lg border">
                <DiffViewer
                  diff={blogDiff}
                  baseRef={`previous version (draft #${parentId})`}
                  isLoading={parentLoading}
                  error={parentError ? 'Could not load the previous version.' : null}
                  onRefresh={onRefreshParent}
                  emptyLabel="No changes to the blog vs the previous version"
                />
              </div>
            ) : null}
          </div>
        </CollapsiblePanel>
      ) : null}
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
  border,
}: {
  label: string;
  value: string;
  tone: string;
  border?: boolean;
}) {
  return (
    <div className={cn('px-3 py-2.5', border && 'border-l border-border')}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</div>
      <div className={cn('mt-0.5 text-sm font-semibold capitalize', tone)}>{value}</div>
    </div>
  );
}
