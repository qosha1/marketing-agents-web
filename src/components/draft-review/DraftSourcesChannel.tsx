'use client';

/**
 * The Sources channel of the draft page (split out of the page, bd
 * startsim-m7fdm.27, to keep it under 1,000 lines). Presentational: the page owns
 * the source state and every write.
 */
import * as React from 'react';
import { Absence } from '@startsimpli/ui';

import type { approvedSourceBasis, approvedSourceGap } from '@/lib/approved-sources';
import type { ParsedSource } from '@/lib/sources';

import { SourcesTool } from './SourcesTool';

export interface DraftSourcesChannelProps {
  attribution: React.ReactNode;
  basis: ReturnType<typeof approvedSourceBasis>;
  sourceGap: ReturnType<typeof approvedSourceGap>;
  onRetry: () => void;
  onOpenApproved: () => void;
  items: ParsedSource[];
  verified: Record<string, boolean>;
  today: Date;
  onAdd: (url: string) => void;
  onRemove: (id: string) => void;
  onToggleVerify: (id: string) => void;
  canEdit: boolean;
}

export function DraftSourcesChannel({
  attribution,
  basis,
  sourceGap,
  onRetry,
  onOpenApproved,
  items,
  verified,
  today,
  onAdd,
  onRemove,
  onToggleVerify,
  canEdit,
}: DraftSourcesChannelProps) {
  return (
      <div className="space-y-3">
        {attribution}
        {/* The badges' basis, when there isn't one. Loading is a not-yet
            (a quiet line); a genuine empty and a failed read are absences
            with different fixes — so they are different cards, and neither
            is a 0, a green tick or a verdict about this draft. */}
        {sourceGap ? (
          basis.state === 'loading' ? (
            <p className="text-sm text-muted-foreground">
              {sourceGap.title} {sourceGap.description}
            </p>
          ) : (
            <Absence
              tier="card"
              title={sourceGap.title}
              description={sourceGap.description}
              why="Which sources count as approved is decided by the tenant’s own Approved Source records. When that list is unavailable nothing is badged, rather than badged against a different list."
              // Retrying is a read, so every reader gets it; going to add
              // approved sources is an editor's errand (bd startsim-sa7vk).
              action={
                !sourceGap.retryable && !canEdit
                  ? undefined
                  : sourceGap.retryable
                  ? {
                      label: 'Try again',
                      onClick: () => {
                        onRetry();
                      },
                    }
                  : {
                      label: 'Open Approved Source',
                      // typeRoute, not a literal: `source` declares an
                      // enum, so the sidebar sends people to /board/…
                      // and a hardcoded /t/… would land them somewhere
                      // the nav never goes.
                      onClick: onOpenApproved,
                    }
              }
            />
          )
        ) : null}
        <SourcesTool
          items={items}
          verified={verified}
          // null — NOT [] — when there is no basis: an empty allow-list
          // would badge every row "unverified", which is a verdict we
          // have not earned. The tool renders an absence instead.
          approvedHosts={basis.state === 'ready' ? basis.hosts : null}
          today={today}
          onAdd={onAdd}
          onRemove={onRemove}
          onToggleVerify={onToggleVerify}
          canEdit={canEdit}
        />
      </div>
  );
}
