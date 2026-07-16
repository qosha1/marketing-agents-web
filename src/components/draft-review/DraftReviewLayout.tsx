'use client';

/**
 * DraftReviewLayout — the two-pane shell for the redesigned draft review (P1).
 *
 * Header (top) → content pane (left, scrolls with the page) + Quality rail (right,
 * ~380px, its own scroll on lg) → decision bar pinned to the bottom, full width.
 * Below `lg` the rail drops under the content and a sticky Content | Quality
 * segmented toggle shows exactly one pane at a time; the decision bar stays pinned.
 *
 * Optionally CONTROLLED (bd 768w.16.15.3): below `lg` the two panes are mutually
 * exclusive, so a jump-to-issue fired FROM the rail would land on a content pane
 * that is still `hidden` — a dead click. Pass `pane` and the page can reveal the
 * content it just jumped into. Omit it and the internal toggle behaves as before.
 *
 * Presentational shell — slots only. All state + persistence live in the draft
 * page. Fork-local for now; extracted to a shared composer once confirmed.
 */
import * as React from 'react';

import { cn } from '@startsimpli/ui/utils';

export type Pane = 'content' | 'quality';

export interface DraftReviewLayoutProps {
  header: React.ReactNode;
  content: React.ReactNode;
  rail: React.ReactNode;
  decisionBar: React.ReactNode;
  /** Controlled visible pane below `lg`. Provide it and the caller owns it. */
  pane?: Pane;
  /** Fires on every pane switch, controlled or not. */
  onPaneChange?: (pane: Pane) => void;
}

export function DraftReviewLayout({
  header,
  content,
  rail,
  decisionBar,
  pane: controlledPane,
  onPaneChange,
}: DraftReviewLayoutProps) {
  const [internalPane, setInternalPane] = React.useState<Pane>('content');
  const pane = controlledPane ?? internalPane;

  const setPane = (next: Pane) => {
    if (controlledPane === undefined) setInternalPane(next);
    onPaneChange?.(next);
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div>{header}</div>

      {/* Narrow-only pane switch — one pane at a time; sticky so it stays reachable. */}
      <div className="sticky top-0 z-10 -mx-8 border-b border-border bg-gray-50/95 px-8 py-2 backdrop-blur lg:hidden">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="tablist" aria-label="Draft pane">
          {(['content', 'quality'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pane === p}
              onClick={() => setPane(p)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                pane === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p === 'content' ? 'Content' : 'Quality'}
            </button>
          ))}
        </div>
      </div>

      {/* Two-pane on lg; stacked (one at a time) below lg. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] lg:items-start lg:gap-6">
        <div className={cn(pane === 'content' ? 'block' : 'hidden', 'lg:block')}>{content}</div>
        <div
          className={cn(
            pane === 'quality' ? 'block' : 'hidden',
            'lg:block lg:sticky lg:top-4 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto',
          )}
        >
          {rail}
        </div>
      </div>

      {/* Decision bar — pinned to the bottom, spanning the full content width. */}
      <div className="sticky bottom-0 -mx-8 flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-gray-50/95 px-8 py-3 backdrop-blur">
        {decisionBar}
      </div>
    </div>
  );
}
