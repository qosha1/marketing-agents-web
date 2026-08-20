/**
 * Marketing Agents home = the system-health dashboard (bd 768w.16.8.5).
 *
 * The home bubbles up the whole system rather than dropping straight into one
 * workflow: what needs a human (as predicates over fields, not status equality),
 * the shape of the content pipeline, and whether ingestion is still running.
 * Topic review itself lives in the Content tabs (the topic status board).
 */
import { DashboardHome } from '@/components/dashboard';

export default function HomePage() {
  return <DashboardHome />;
}
