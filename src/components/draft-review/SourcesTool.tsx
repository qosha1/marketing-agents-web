'use client';

/**
 * SourcesTool — the Sources channel of the draft-review content pane (P2).
 *
 * Turns the draft's stored `sources` (opaque strings behind the brief) into an
 * actionable evidence tool: each row shows publisher · tier (approved when the
 * host is on the OGMC allow-list, else unverified) · date with a staleness flag ·
 * Open · Verify (a reviewer-only flag) · the note. A coverage banner at the top
 * ties thin/stale sourcing to the AI judge's recency / source-reliability concern,
 * so a "revise" verdict becomes something to FIX (find a fresher / second source)
 * rather than a verdict to stare at. Add-a-source checks the pasted URL's host
 * against the allow-list and shows its tier immediately.
 *
 * Controlled + presentational: the page owns the parsed rows + the `verified` map +
 * all persistence (parse → edit → re-serialize preserves the stored format; the
 * `verified` flag rides a separate blob key). Fork-local for now. (TODO 768w.16:
 * upstream a generic Sources tool to @startsimpli/ui once the OGMC shape settles.)
 */
import * as React from 'react';
import { ExternalLink, Plus, ShieldCheck, ShieldQuestion, Check, Trash2, AlertTriangle } from 'lucide-react';

import { cn } from '@startsimpli/ui/utils';
import type { JudgeVerdict } from '@startsimpli/ui';

import type { ParsedSource } from '@/lib/sources';
import {
  ageLabel,
  coverageSummary,
  formatSourceDate,
  hostOf,
  isStale,
  sourceAgeDays,
  sourceTier,
} from '@/lib/sources';

export interface SourcesToolProps {
  items: ParsedSource[];
  /** Reviewer's per-source verified flags, keyed by source id (its url/raw). */
  verified: Record<string, boolean>;
  approvedHosts: string[];
  today: Date;
  judgeVerdict?: JudgeVerdict;
  /**
   * Source URLs an active jump-to-issue is pointing at (bd 768w.16.15.3) — the
   * approved-sources check's `matches`. Rows are a list, not prose, so the offending
   * ones are marked outright instead of highlighting a substring of them.
   */
  flagged?: string[];
  onAdd(url: string): void;
  onRemove(id: string): void;
  onToggleVerify(id: string): void;
}

/** Stable identity for "nothing flagged". */
const NO_FLAGS: string[] = [];

/** The judge's guardrails that the Sources tool can act on (recency / sourcing). */
function sourcingConcerns(judge?: JudgeVerdict): string[] {
  const issues = judge?.issues ?? [];
  return issues
    .filter((i) => /recen|source|reliab|citation|fresh/i.test(`${i.guardrail ?? ''} ${i.problem ?? ''}`))
    .map((i) => i.guardrail || i.problem || '')
    .filter(Boolean);
}

export function SourcesTool({
  items,
  verified,
  approvedHosts,
  today,
  judgeVerdict,
  flagged = NO_FLAGS,
  onAdd,
  onRemove,
  onToggleVerify,
}: SourcesToolProps) {
  const [draftUrl, setDraftUrl] = React.useState('');
  const cov = coverageSummary(items, today);
  const concerns = sourcingConcerns(judgeVerdict);

  const draftHost = hostOf(draftUrl.trim());
  const draftTier = draftUrl.trim() ? sourceTier(draftUrl.trim(), approvedHosts) : null;

  const submitAdd = () => {
    const url = draftUrl.trim();
    if (!url) return;
    onAdd(url);
    setDraftUrl('');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sources · evidence behind the brief
        </h3>
        <span className="text-xs text-muted-foreground">
          {cov.count} source{cov.count === 1 ? '' : 's'}
        </span>
      </div>

      {/* Coverage warning — tied to the judge's recency / sourcing concern. */}
      {cov.concern ? (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <div className="space-y-1 text-[13px] leading-relaxed">
            <p>
              <b className="font-semibold">
                {cov.count <= 1 ? 'One source backs the whole brief' : `${cov.count} sources`}
                {cov.oldestDays != null ? ` — oldest is ${ageLabel(cov.oldestDays)}` : ''}.
              </b>{' '}
              {concerns.length > 0
                ? `The AI judge's ${concerns.join(' + ')} concern points here — `
                : 'This is what a "revise" wants fixed — '}
              add a second or fresher source so the claims do not rest on a single, aging citation.
            </p>
          </div>
        </div>
      ) : null}

      {/* Source rows */}
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No sources recorded for this draft yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              tier={sourceTier(s.url, approvedHosts)}
              ageDays={sourceAgeDays(s.date, today)}
              verified={!!verified[s.id]}
              // The check extracts URLs from the same rows we render, so an exact
              // match is the honest test: a row that doesn't match simply isn't
              // marked — the jump still opened this channel.
              flagged={flagged.includes(s.url)}
              onToggleVerify={() => onToggleVerify(s.id)}
              onRemove={() => onRemove(s.id)}
            />
          ))}
        </ul>
      )}

      {/* Add a source */}
      <div className="rounded-xl border border-dashed border-border bg-card p-3">
        <label htmlFor="add-source" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Add a source — paste a URL; it is checked against the approved-source list
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="add-source"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitAdd();
              }
            }}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-0"
          />
          {draftTier ? (
            <TierBadge tier={draftTier} host={draftHost} />
          ) : null}
          <button
            type="button"
            onClick={submitAdd}
            disabled={!draftUrl.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceRow({
  source,
  tier,
  ageDays,
  verified,
  flagged,
  onToggleVerify,
  onRemove,
}: {
  source: ParsedSource;
  tier: 'approved' | 'unverified';
  ageDays: number | null;
  verified: boolean;
  flagged: boolean;
  onToggleVerify: () => void;
  onRemove: () => void;
}) {
  const stale = isStale(ageDays);
  return (
    <li
      className={cn(
        'rounded-xl border border-border bg-card p-3',
        flagged && 'border-amber-400 ring-2 ring-amber-300',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-[11px] font-bold',
            tier === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500',
          )}
          aria-hidden="true"
        >
          {tier === 'approved' ? 'T1' : '—'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {source.publisher || hostOf(source.url) || 'Source'}
              </p>
              {source.note ? (
                <p className="text-xs text-muted-foreground">{source.note}</p>
              ) : null}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Open
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
              <button
                type="button"
                onClick={onToggleVerify}
                aria-pressed={verified}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                  verified
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                {verified ? <Check className="h-3 w-3" /> : null}
                {verified ? 'Verified' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${source.publisher || source.url}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TierBadge tier={tier} host={hostOf(source.url)} />
            {source.date ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                  stale ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground',
                )}
              >
                {formatSourceDate(source.date)}
                {ageDays != null ? ` · ${ageLabel(ageDays)}` : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                no date
              </span>
            )}
            {source.url ? (
              flagged ? (
                <mark className="truncate rounded-md bg-amber-200 px-1 text-[11px] font-medium text-amber-900">
                  {hostOf(source.url) || source.url}
                </mark>
              ) : (
                <span className="truncate rounded-md px-1 text-[11px] text-primary/80">
                  {hostOf(source.url) || source.url}
                </span>
              )
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function TierBadge({ tier, host }: { tier: 'approved' | 'unverified'; host: string }) {
  if (tier === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        <ShieldCheck className="h-3 w-3" />
        Tier 1 · approved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
      <ShieldQuestion className="h-3 w-3" />
      Unverified{host ? ` · ${host}` : ''}
    </span>
  );
}
