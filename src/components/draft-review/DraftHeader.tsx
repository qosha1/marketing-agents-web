'use client';

/**
 * DraftHeader — the draft page's ONE header (bd startsim-m7fdm.27).
 *
 * Quinn, 2026-10-09: "why are there like 4 columns ... then the header section
 * in a totally different design and duplicated??? theres 2 different titles??"
 * Before this the page opened with a boxed topic card carrying its own title,
 * then a second header with the draft title, status and queue arrows. Now there
 * is one title (the draft's, which IS the topic's story, e10), one row of
 * quiet controls, and the topic's angle and Edit topic under it.
 *
 * Presentational — slots only; the page owns every piece of state.
 */
import * as React from 'react';
import { History } from 'lucide-react';

import { cn } from '@startsimpli/ui/utils';

export interface DraftHeaderProps {
  /** The back link (e01). */
  back: React.ReactNode;
  /** The only title on the page. */
  title: string;
  /** "Edited by" under the title. */
  titleMeta?: React.ReactNode;
  /** Status pill (+ its edited-by, + candidate pill). */
  status?: React.ReactNode;
  /** Language chips and translate buttons. */
  languages?: React.ReactNode;
  historyOpen: boolean;
  onHistory: () => void;
  /** The topic strip: angle, market chips, Edit topic. */
  children?: React.ReactNode;
}

export function DraftHeader({
  back,
  title,
  titleMeta,
  status,
  languages,
  historyOpen,
  onHistory,
  children,
}: DraftHeaderProps) {
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {back}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {status}
          <button
            type="button"
            onClick={onHistory}
            aria-expanded={historyOpen}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100',
              historyOpen && 'bg-neutral-100 text-neutral-900',
            )}
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            History
          </button>
        </div>
      </div>
      <h1 className="text-xl font-semibold leading-snug">{title}</h1>
      {titleMeta}
      {languages}
      {children}
    </header>
  );
}
