/**
 * Marketing Agents home = the system-health dashboard (bd 768w.16.8.5).
 *
 * The home bubbles up the whole system (content pipeline, source freshness, delivery
 * adherence, needs-attention queue) rather than dropping straight into one workflow.
 * Topic review now lives in the Content tabs (the topic status board), not the home.
 */
import { DashboardHome } from '@/components/dashboard';

export default function HomePage() {
  return <DashboardHome />;
}
