'use client';

/**
 * Draft review = the "compare candidates, pick one, review it, approve" workspace
 * (bd startsim-768w.18.5 / .18.6). Sits next to the topic Review home; the writer
 * fills it once a topic goes "ready".
 */
import { DraftReviewWorkspace } from '@/components/draft-review';

export default function DraftsPage() {
  return <DraftReviewWorkspace />;
}
