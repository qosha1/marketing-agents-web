'use client';

/**
 * CollapsiblePanel — a single collapsible card for the draft-review Quality rail
 * (P1 of the redesigned review flow). Fork-local for now; extracted to a shared
 * composer once the two-pane design is confirmed.
 *
 * A bordered card whose header toggles a body open/closed. The body is meant to
 * hold a shared review primitive (ValidationChecklist / ReviewScorecard /
 * ReviewNotes) FLATTENED (card chrome stripped) so the panel supplies the single
 * card + title and the primitive stays otherwise intact.
 */
import * as React from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@startsimpli/ui/utils';

export interface CollapsiblePanelProps {
  title: string;
  /** A small metric/badge rendered at the right of the header (e.g. "7/8"). */
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function CollapsiblePanel({
  title,
  badge,
  defaultOpen = false,
  children,
  className,
}: CollapsiblePanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <ChevronRight
            className={cn('h-4 w-4 flex-shrink-0 text-neutral-400 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          {title}
        </span>
        {badge != null ? <span className="flex-shrink-0">{badge}</span> : null}
      </button>
      {open ? <div className="border-t border-border px-4 py-4">{children}</div> : null}
    </div>
  );
}

/** twMerge-friendly className that flattens a shared primitive's outer card so a
 *  CollapsiblePanel can supply the single card + padding around it. */
export const FLATTEN_CARD = 'rounded-none border-0 bg-transparent p-0 shadow-none';
