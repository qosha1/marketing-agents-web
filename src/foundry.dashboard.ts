/**
 * The marketing-agents home dashboard config (bd 768w.16.8.5).
 *
 * Declares the health widgets the home lays out, in order. This is the one place to
 * add/reorder/rename home widgets — DashboardHome just renders whatever is listed
 * here. Sits alongside foundry.config.ts / foundry.nav.ts as the app's per-fork
 * configuration surface.
 *
 * Order is the reading order: what needs a human, then the shape of the pipeline,
 * then whether the machine feeding it is still running.
 */
import type { DashboardConfig } from '@/components/dashboard/config';

export const dashboardConfig: DashboardConfig = {
  title: 'System health',
  description:
    'What needs a human right now, the shape of the content pipeline, and whether ingestion is still running.',
  widgets: [
    { kind: 'attention', title: 'What needs a human' },
    { kind: 'pipeline-health' },
    { kind: 'ingestion' },
  ],
};
