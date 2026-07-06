'use client';

/**
 * Marketing Agents home = the OGMC topic review workspace (the "live-ranked list"
 * from the team call). Reviewing + ranking topics is the daily job, so it's the
 * landing surface. Other sections (News Item, Draft, Client, Approved Source)
 * remain in the sidebar.
 */
import { TopicReviewWorkspace } from '@/components/topic-review';

export default function HomePage() {
  return <TopicReviewWorkspace />;
}
