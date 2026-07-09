'use client';

/**
 * The OGMC topic review workspace — the "live-ranked list" daily triage tool.
 * It used to be the home; the dashboard now lands first, so it lives here and is
 * reachable from the sidebar's "Review" link.
 */
import { TopicReviewWorkspace } from '@/components/topic-review';

export default function ReviewPage() {
  return <TopicReviewWorkspace />;
}
