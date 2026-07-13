/**
 * The marketing-agents home dashboard config (bd 768w.16.8.5).
 *
 * Declares the health widgets the home lays out, in order. This is the one place to
 * add/reorder/rename home widgets — DashboardHome just renders whatever is listed
 * here. Sits alongside foundry.config.ts / foundry.nav.ts as the app's per-fork
 * configuration surface.
 */
import type { DashboardConfig } from '@/components/dashboard/config';

export const dashboardConfig: DashboardConfig = {
  title: 'System health',
  description: 'How the content system is doing right now — pipeline, sources, delivery, and what needs a human.',
  widgets: [
    { kind: 'pipeline-health' },
    { kind: 'source-freshness' },
    { kind: 'delivery-health' },
    { kind: 'attention' },
  ],
};
