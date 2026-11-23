'use client';

/**
 * One text channel of the draft (Blog, LinkedIn): who last edited it, then the
 * track-changes editor once the reader's role is known (split out of the page,
 * bd startsim-m7fdm.27, to keep it under 1,000 lines).
 */
import * as React from 'react';

import { TrackedSection, type TrackedSectionProps } from './TrackedSection';

export interface DraftChannelEditorProps extends TrackedSectionProps {
  attribution: React.ReactNode;
  /** The signed-in actor's sub; null until the role read lands. */
  actorSub: string | undefined;
  /** What to show until then (loading, or a failed read with a retry). */
  pending: React.ReactNode;
}

export function DraftChannelEditor({ attribution, actorSub, pending, ...section }: DraftChannelEditorProps) {
  return (
    <div className="space-y-2">
      {attribution}
      {actorSub !== undefined ? <TrackedSection {...section} currentActorSub={actorSub} /> : pending}
    </div>
  );
}
