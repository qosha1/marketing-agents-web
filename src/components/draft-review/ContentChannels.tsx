'use client';

/**
 * ContentChannels — the channel-tabbed content pane of the draft review (P2).
 *
 * One focused channel at a time (Brief · LinkedIn · SEO · Sources) instead of a
 * long scroll of every section stacked. Tabs carry a small badge (word count /
 * source count) and an optional warn dot when a channel needs attention. The
 * active channel is reflected in a `?channel=` query param (shareable / reloadable)
 * but the source of truth is local state, so switching never round-trips the server.
 * Every channel's content stays MOUNTED (hidden when inactive) so a debounced edit
 * in one channel isn't lost by switching to another mid-save.
 *
 * Presentational shell — slots only; the page owns each channel's editor + state.
 * Fork-local for now; extracted alongside the two-pane shell once confirmed.
 */
import * as React from 'react';
import { useSearchParams } from 'next/navigation';

import { cn } from '@startsimpli/ui/utils';

export interface Channel {
  id: string;
  label: string;
  /** Small count badge (e.g. "462w", "1"). */
  badge?: React.ReactNode;
  /** Show an amber "needs attention" dot on the tab. */
  warn?: boolean;
  content: React.ReactNode;
}

export interface ContentChannelsProps {
  channels: Channel[];
  defaultChannel?: string;
}

export function ContentChannels({ channels, defaultChannel }: ContentChannelsProps) {
  const searchParams = useSearchParams();
  const ids = React.useMemo(() => channels.map((c) => c.id), [channels]);
  const fallback = defaultChannel && ids.includes(defaultChannel) ? defaultChannel : ids[0];

  const [active, setActive] = React.useState<string>(() => {
    const q = searchParams.get('channel');
    return q && ids.includes(q) ? q : fallback;
  });

  // Keep the active tab in view of the URL without a server round-trip.
  const select = (id: string) => {
    setActive(id);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('channel', id);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        role="tablist"
        aria-label="Content channel"
        className="flex flex-wrap gap-1 border-b border-border bg-muted/40 px-2 pt-1.5"
      >
        {channels.map((c) => {
          const on = c.id === active;
          return (
            <button
              key={c.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => select(c.id)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                on
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
              {c.badge != null ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                    on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {c.badge}
                </span>
              ) : null}
              {c.warn ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-amber-500"
                  aria-label="needs attention"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {channels.map((c) => (
          <div key={c.id} hidden={c.id !== active} role="tabpanel">
            {c.content}
          </div>
        ))}
      </div>
    </div>
  );
}
