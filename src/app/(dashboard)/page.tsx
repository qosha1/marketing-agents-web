'use client';

/**
 * Home = the Marketing Agents dashboard: an at-a-glance overview of source
 * health and article collection metrics (docs/foundry/build-spec.md). The topic
 * review workspace still lives one click away at /review.
 */
import { MarketingDashboard } from '@/components/marketing-dashboard';

export default function HomePage() {
  return <MarketingDashboard />;
}
