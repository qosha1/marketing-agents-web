'use client';

/**
 * CollapsiblePanel — a single collapsible card for the draft page's History rail
 * and the record drawers. Fork-local for now; extracted to a shared composer
 * once the two-pane design is confirmed.
 *
 * A bordered card whose header toggles a body open/closed. The body is meant to
 * hold a shared primitive (e.g. RecordHistoryPanel) FLATTENED (card chrome
 * stripped) so the panel supplies the single card + title and the primitive
 * stays otherwise intact.
 */
import * as React from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@startsimpli/ui/utils';

export interface CollapsiblePanelProps {
  title: string;
  /** A small metric/badge rendered at the right of the header (e.g. "7/8"). */
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  /**
   * CONTROLLED mode. Pass it and the host owns the open state — which the stale-
   * save dialog needs: its safe default action is "See what changed", and that
   * has to be able to open the history panel in the rail from outside it. Omit
   * it and the panel keeps its own state exactly as before.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export function CollapsiblePanel({
  title,
  badge,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: CollapsiblePanelProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: (current: boolean) => boolean) => {
    const value = next(open);
    if (controlledOpen === undefined) setUncontrolledOpen(value);
    onOpenChange?.(value);
  };
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
