'use client';

/**
 * QualityRail — the cleaned review rail of the two-pane draft review (P2).
 *
 * The P1 rail asked the reviewer to fill a scorecard verdict AND five per-dimension
 * notes AND an overall note AND then pick a decision-bar button — three competing
 * verdict controls. P2 collapses that to ONE decision:
 *
 *   • Signals (read-only) — Checks x/n + the AI judge verdict shown as a SUGGESTION
 *     (never a control). The judge's full reasoning stays reachable in the
 *     Validation panel below.
 *   • Issues (P3, bd 768w.16.15.3) — "Checks 7/8" is a score, not a location: it
 *     names neither what failed nor where. So every non-passing check is listed
 *     here, always open, as a BUTTON that jumps the content pane to the offending
 *     field and marks the text. Validation below keeps the full detail + override.
 *   • Decision — a single verdict control (Approve / Request changes / Reject) that
 *     DRIVES the decision-bar's one primary action (Accept / Request revision /
 *     Reject). "Request changes" reveals ONE feedback box ("what should the rewrite
 *     fix?", stored on `review.overallNote` so compileFeedback keeps feeding the
 *     same n8n revise webhook) plus quick-add chips seeded from the judge's issues.
 *   • Adjust the AI's scores — collapsed; the five dimensions PRE-FILL from the AI's
 *     stored scores and the human overrides only what they disagree with (→
 *     review.dimensions[key].score). Not five blank inputs.
 *   • Validation — the shared ValidationChecklist (deterministic checks + the AI
 *     judge's issues/scores/summary + the reasoned-override affordance), kept intact.
 *   • Notes — a small ReviewNotes affordance (section notes still feed the revise
 *     loop). TODO 768w.16: true inline paragraph pins need an upstream anchor model.
 *   • Revision history — lineage chips + on-demand blog diff, unchanged.
 *
 * Presentational — all state + persistence stay in the draft page. Fork-local.
 */
import * as React from 'react';
import Link from 'next/link';

import {
  ValidationChecklist,
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
  type ReviewDimension,
} from '@startsimpli/ui';

import { cn } from '@startsimpli/ui/utils';
import type { EntityRecord } from '@/lib/foundry-api';
import type { IssueStop } from '@/lib/issue-jump';
import { CollapsiblePanel, FLATTEN_CARD } from './CollapsiblePanel';

type Call = NonNullable<ReviewScore['verdict']>;

export interface QualityRailProps {
  // Signals + Validation
  checks: ContentCheck[];

  // Jump-to-issue (bd 768w.16.15.3)
  /** Every place a non-passing check can send the reviewer, in rail order. */
  stops: IssueStop[];
  /** Index into `stops` of the issue currently jumped to; -1 when none. */
  activeStop: number;
  /** Jump to a check — its first location, or its next one if already there. */
  onJumpToCheck: (checkId: string) => void;
  legendOpen: boolean;
  onToggleLegend: () => void;

  judgeVerdict?: JudgeVerdict;
  /** The stored AI-judge verdict word (display-only suggestion). */
  judgeVerdictWord: string;
  override: ValidationOverride;
  onOverride: (next: ValidationOverride) => void;

  // Decision + scores
  review: ReviewScore;
  onReviewChange: (next: ReviewScore) => void;
  /** Whether the compiled feedback is non-empty (drives the revise-ready hint). */
  feedbackReady: boolean;
  /** Whether Accept is currently unlocked (checks ok + approve). */
  canAccept: boolean;
  /** The gating hint when Accept is blocked (null when unlocked). */
  acceptGateHint: string | null;

  // Notes (small affordance — section notes still feed the revise loop)
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

function judgeTone(word: string): string {
  const v = word.toLowerCase();
  if (/pass|approve|accept|ok|good/.test(v)) return 'text-emerald-700';
  if (/fail|reject|block|deny|bad/.test(v)) return 'text-red-700';
  if (!v) return 'text-neutral-400';
  return 'text-amber-700';
}

/** Reduce a dimension/score key to alnum tokens so 'source-reliability' matches
 *  the judge's 'source_reliability' / 'sourceReliability'. */
function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Coerce a stored judge score (number | "4" | {score:4}) to a 1–5 number or undefined. */
function coerceScore(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === 'object') {
    const s = (v as Record<string, unknown>).score;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
    if (typeof s === 'string' && Number.isFinite(Number(s))) return Number(s);
  }
  return undefined;
}

/** The AI's score for a dimension, matched loosely against judge_verdict.scores. */
function aiScoreFor(dim: ReviewDimension, scores?: Record<string, unknown>): number | undefined {
  if (!scores) return undefined;
  const want = normKey(dim.key);
  const wantLabel = normKey(dim.label);
  for (const [k, v] of Object.entries(scores)) {
    const nk = normKey(k);
    if (nk === want || nk === wantLabel || nk.includes(want) || want.includes(nk)) {
      return coerceScore(v);
    }
  }
  return undefined;
}

const CALLS: { id: Call; label: string; sel: string }[] = [
  { id: 'approve', label: 'Approve', sel: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
  { id: 'revise', label: 'Request changes', sel: 'border-amber-500 bg-amber-50 text-amber-700' },
  { id: 'reject', label: 'Reject', sel: 'border-red-500 bg-red-50 text-red-700' },
];

export function QualityRail(props: QualityRailProps) {
  const {
    checks,
    stops,
    activeStop,
    onJumpToCheck,
    legendOpen,
    onToggleLegend,
    judgeVerdict,
    judgeVerdictWord,
    override,
    onOverride,
    review,
    onReviewChange,
    feedbackReady,
    canAccept,
    acceptGateHint,
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
  const call = review.verdict;
  const currentVersion = Math.max(1, chain.findIndex((d) => String(d.id) === currentId) + 1);
  const hasHistory = chain.length > 1 || !!parentId;

  const setCall = (next: Call) => onReviewChange({ ...review, verdict: next });
  const setFeedback = (text: string) => onReviewChange({ ...review, overallNote: text });

  // Quick-add chips seeded from the judge's flagged issues → append to the feedback.
  const issueChips = (judgeVerdict?.issues ?? [])
    .map((i) => ({
      label: i.guardrail || i.problem || 'issue',
      text: i.fix || i.problem || i.guardrail || '',
    }))
    .filter((c) => c.text);

  const appendFeedback = (text: string) => {
    const cur = review.overallNote ?? '';
    if (cur.toLowerCase().includes(text.toLowerCase())) return; // already added
    setFeedback(cur ? `${cur.replace(/\s*$/, '')}\n- ${text}` : `- ${text}`);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Read-only signals */}
      <div className="grid grid-cols-2 gap-2">
        <Signal label="Checks" value={total ? `${passCount}/${total}` : '—'} tone={total ? checksTone : 'text-neutral-400'} />
        <Signal
          label="AI judge suggests"
          value={judgeVerdictWord || '—'}
          tone={judgeTone(judgeVerdictWord)}
          why={judgeVerdict?.summary}
        />
      </div>

      {/* Issues — the failing checks, named and reachable. */}
      <IssuePanel
        checks={checks}
        stops={stops}
        activeStop={activeStop}
        onJumpToCheck={onJumpToCheck}
        legendOpen={legendOpen}
        onToggleLegend={onToggleLegend}
      />

      {/* THE one decision */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="px-4 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Decision</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {call === 'approve'
              ? 'You approve — the button below becomes Accept.'
              : call === 'revise'
                ? 'You want changes — describe them, then send to the AI.'
                : call === 'reject'
                  ? 'You reject this candidate — sibling drafts stay.'
                  : 'Read it, then decide — this drives the button below.'}
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-3 pt-2.5">
          {CALLS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={call === c.id}
              onClick={() => setCall(c.id)}
              className={cn(
                'flex-1 rounded-lg border px-1 py-2 text-sm font-semibold transition-colors',
                call === c.id ? c.sel : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* revise → single feedback box + judge-seeded chips */}
        {call === 'revise' ? (
          <div className="border-t border-border bg-muted/30 px-4 py-3">
            <label htmlFor="revise-feedback" className="mb-1.5 block text-xs font-semibold text-foreground">
              What should the rewrite fix?
            </label>
            <textarea
              id="revise-feedback"
              rows={3}
              value={review.overallNote ?? ''}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Tell the AI what to change (a fresher/second source, softer tone, fix a claim…)"
              className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-0"
            />
            {issueChips.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">From the judge:</span>
                {issueChips.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => appendFeedback(c.text)}
                    className="rounded-full border border-dashed border-amber-400 bg-background px-2.5 py-0.5 text-[11px] text-amber-700 hover:bg-amber-50"
                    title={c.text}
                  >
                    + {c.label}
                  </button>
                ))}
              </div>
            ) : null}
            {!feedbackReady ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">Add feedback to enable Request revision.</p>
            ) : null}
          </div>
        ) : null}

        {/* approve → gate note */}
        {call === 'approve' ? (
          <div
            className={cn(
              'border-t px-4 py-3 text-xs',
              canAccept ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
            )}
          >
            {canAccept
              ? 'You’re signing off — Accept is unlocked.'
              : acceptGateHint ?? 'Checks still gate Accept — fix them or record a reasoned override in Validation.'}
          </div>
        ) : null}

        {/* reject → note */}
        {call === 'reject' ? (
          <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            This candidate is dropped (marked not-chosen). Its sibling drafts stay available.
          </div>
        ) : null}
      </div>

      {/* Scores react to the AI — collapsed */}
      <ScoreAdjust review={review} onReviewChange={onReviewChange} judgeVerdict={judgeVerdict} />

      {/* Validation — deterministic checks + AI-judge reasoning + reasoned override. */}
      <CollapsiblePanel
        title="Validation"
        defaultOpen={overall === 'fail' && !override.overridden}
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

      {/* Notes — small affordance; section notes still feed the revise loop. */}
      <CollapsiblePanel
        title="Notes"
        badge={<span className="font-mono text-xs text-neutral-500">{notes.filter((n) => !n.resolved).length || ''}</span>}
      >
        <div className="space-y-2">
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
            emptyMessage="No pinned notes yet."
            className={FLATTEN_CARD}
          />
          <p className="text-[11px] text-neutral-400">
            {/* TODO 768w.16: inline paragraph pins need an upstream anchor model on the shared editor. */}
            Notes are added to the rewrite feedback too.
          </p>
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

/** How a field reads in the rail — the reviewer thinks "the blog", not "blog". */
const FIELD_LABEL: Record<string, string> = {
  blog: 'the blog',
  headline: 'the headline',
  linkedin: 'the LinkedIn post',
  metaDescription: 'the meta description',
  tags: 'the tags',
  sources: 'the sources',
};

const ISSUE_TONE: Record<CheckStatus, string> = {
  pass: 'bg-emerald-500',
  warn: 'bg-amber-500',
  fail: 'bg-red-500',
};

/**
 * The non-passing checks as jump controls (bd 768w.16.15.3).
 *
 * Each is a real <button> — the rail is keyboard territory (j/k walk this same
 * list), so a div+onClick would be unreachable by tab and unnamed to a screen
 * reader. A check with no jumpable location renders as static text instead: it
 * still needs to be READ, but offering a control that goes nowhere is worse than
 * offering none.
 */
function IssuePanel({
  checks,
  stops,
  activeStop,
  onJumpToCheck,
  legendOpen,
  onToggleLegend,
}: {
  checks: ContentCheck[];
  stops: IssueStop[];
  activeStop: number;
  onJumpToCheck: (checkId: string) => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
}) {
  const failing = checks.filter((c) => c.status !== 'pass');
  if (failing.length === 0) return null;

  const active = activeStop >= 0 ? stops[activeStop] : undefined;

  return (
    <div className="overflow-hidden rounded-xl border border-amber-200 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          {failing.length} issue{failing.length === 1 ? '' : 's'} to look at
        </div>
        <button
          type="button"
          onClick={onToggleLegend}
          aria-expanded={legendOpen}
          aria-label="Keyboard shortcuts"
          className="grid h-5 w-5 place-items-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          ?
        </button>
      </div>
      <p className="px-4 pb-1 pt-0.5 text-xs text-muted-foreground">
        Jump to what failed — or press <Key>j</Key> / <Key>k</Key>.
      </p>

      {legendOpen ? <ShortcutLegend /> : null}

      <ul className="px-2 pb-2 pt-1">
        {failing.map((c) => {
          const mine = stops.filter((s) => s.checkId === c.id);
          const on = !!active && active.checkId === c.id;
          // Where this jump lands. Multi-location checks (no-hype spans fields)
          // name the CURRENT target once active, so re-clicking to advance is
          // legible rather than mysterious.
          const where = on ? active.field : mine[0]?.field;
          const whereLabel = where ? (FIELD_LABEL[where] ?? where) : null;
          const body = (
            <>
              <span className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', ISSUE_TONE[c.status])} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-foreground">{c.label}</span>
                {c.detail ? (
                  <span className="block truncate text-[11px] text-muted-foreground">{c.detail}</span>
                ) : null}
                {whereLabel ? (
                  <span className="block text-[11px] text-primary/80">
                    in {whereLabel}
                    {mine.length > 1 ? ` · ${mine.findIndex((s) => s.field === where) + 1}/${mine.length}` : ''}
                  </span>
                ) : null}
              </span>
            </>
          );

          if (mine.length === 0) {
            return (
              <li
                key={c.id}
                className="flex gap-2 rounded-lg px-2 py-1.5 text-left opacity-70"
                title="This check has no field to jump to."
              >
                {body}
              </li>
            );
          }

          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onJumpToCheck(c.id)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'flex w-full gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                  on ? 'bg-amber-50 ring-1 ring-amber-300' : 'hover:bg-muted',
                )}
              >
                {body}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-foreground">
      {children}
    </kbd>
  );
}

function ShortcutLegend() {
  const rows: [React.ReactNode, string][] = [
    [
      <>
        <Key>j</Key> / <Key>k</Key>
      </>,
      'Next / previous issue',
    ],
    [<Key key="a">a</Key>, 'Approve'],
    [<Key key="r">r</Key>, 'Request changes'],
    [<Key key="x">x</Key>, 'Reject'],
    [<Key key="?">?</Key>, 'Show / hide this list'],
  ];
  return (
    <dl className="mx-2 mb-1 space-y-1 rounded-lg bg-muted/50 px-3 py-2">
      {rows.map(([keys, what], i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
          <dt className="flex items-center gap-1">{keys}</dt>
          <dd className="text-muted-foreground">{what}</dd>
        </div>
      ))}
      <p className="pt-0.5 text-[10px] text-muted-foreground">Shortcuts pause while you type.</p>
    </dl>
  );
}

function Signal({ label, value, tone, why }: { label: string; value: string; tone: string; why?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</div>
      <div className={cn('mt-0.5 text-sm font-semibold capitalize', tone)}>{value}</div>
      {why ? <div className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-neutral-400">{why}</div> : null}
    </div>
  );
}

/** Collapsed "Adjust the AI's scores": five dimensions pre-filled from the AI's
 *  stored scores; the human overrides only what they disagree with. */
function ScoreAdjust({
  review,
  onReviewChange,
  judgeVerdict,
}: {
  review: ReviewScore;
  onReviewChange: (next: ReviewScore) => void;
  judgeVerdict?: JudgeVerdict;
}) {
  const [open, setOpen] = React.useState(false);
  const dims = DEFAULT_REVIEW_DIMENSIONS;

  const setScore = (key: string, score: number) => {
    const dimensions = { ...(review.dimensions ?? {}) };
    dimensions[key] = { ...dimensions[key], score };
    onReviewChange({ ...review, dimensions });
  };

  const overriddenCount = dims.filter((d) => review.dimensions?.[d.key]?.score != null).length;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-neutral-800">Adjust the AI&rsquo;s scores</span>
        <span className="text-[11px] text-primary">
          {overriddenCount > 0 ? `${overriddenCount} overridden` : 'optional'} {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="border-t border-border px-4 py-2">
          {dims.map((d) => {
            const ai = aiScoreFor(d, judgeVerdict?.scores);
            const human = review.dimensions?.[d.key]?.score;
            const shown = human ?? ai;
            const low = ai != null && ai <= 3;
            return (
              <div key={d.key} className="flex items-center gap-2 border-b border-dashed border-border py-2 last:border-b-0">
                <span className="flex-1 text-[13px] text-foreground">{d.label}</span>
                <span className={cn('font-mono text-[11px]', low ? 'text-amber-700' : 'text-muted-foreground')}>
                  AI {ai ?? '—'}/5
                </span>
                <div className="flex items-center gap-0.5" role="group" aria-label={`${d.label} score`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setScore(d.key, n)}
                      aria-label={`${d.label}: ${n}`}
                      className={cn(
                        'h-3.5 w-3.5 rounded-full',
                        shown != null && n <= shown ? 'bg-neutral-900' : 'bg-neutral-200 hover:bg-neutral-300',
                      )}
                    />
                  ))}
                </div>
                {human != null && human !== ai ? (
                  <span className="w-10 text-right text-[10px] text-primary">you {human}</span>
                ) : (
                  <span className="w-10" />
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
