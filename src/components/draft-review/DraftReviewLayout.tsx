'use client';

/**
 * DraftReviewLayout — the two-pane shell for the draft page.
 *
 * Header (top) → content pane (left, scrolls with the page) + History rail
 * (right, ~380px, its own scroll on lg) → an optional bar pinned to the bottom.
 *
 * Below `lg` the rail stacks UNDER the content. It used to sit behind a sticky
 * Content | Quality switch, one pane at a time; with the Checks section, the
 * decision and Notes removed (bd startsim-m7fdm.25) the rail holds only the
 * draft's history, and a whole tab for one collapsed card read as a broken,
 * empty pane. Stacked, the reviewer scrolls past the text to its history, and
 * the page brings the rail into view when something opens History from outside
 * (a field's "edited by" line, the stale-save dialog) via `railRef`.
 *
 * Presentational shell — slots only. All state + persistence live in the draft
 * page. Fork-local for now; extracted to a shared composer once confirmed.
 */
import * as React from 'react';

export interface DraftReviewLayoutProps {
  header: React.ReactNode;
  content: React.ReactNode;
  rail: React.ReactNode;
  /** The pinned bottom bar. Null or absent renders no bar at all. */
  decisionBar?: React.ReactNode;
  /** The rail's container, so the page can scroll it into view on narrow screens. */
  railRef?: React.Ref<HTMLDivElement>;
}

export function DraftReviewLayout({ header, content, rail, decisionBar, railRef }: DraftReviewLayoutProps) {
  return (
    <div className="flex flex-col gap-4 pb-4">
      <div>{header}</div>

      {/* Two-pane on lg; stacked (content, then history) below lg. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] lg:items-start">
        <div className="min-w-0">{content}</div>
        <div
          ref={railRef}
          className="scroll-mt-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto"
        >
          {rail}
        </div>
      </div>

      {decisionBar ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-gray-50/95 px-4 py-3 sm:-mx-8 sm:px-8 backdrop-blur">
          {decisionBar}
        </div>
      ) : null}
    </div>
  );
}
