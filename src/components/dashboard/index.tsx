'use client';

/**
 * DashboardHome — the tenant home (bd 768w.16.8.5).
 *
 * Lays the declared health widgets (foundry.dashboard config) into a grid so the
 * home bubbles up the whole system at a glance: content pipeline, source freshness,
 * delivery adherence, and the needs-a-human queue. The composition is data-driven —
 * add/reorder widgets in src/foundry.dashboard.ts, not here.
 */
import { DashboardGrid, DashboardSection } from '@startsimpli/ui';

import type { DashboardConfig, DashboardWidget } from '@/components/dashboard/config';
import {
  AttentionWidget,
  DeliveryHealthWidget,
  PipelineHealthWidget,
  SourceFreshnessWidget,
} from '@/components/dashboard/widgets';
import { dashboardConfig } from '@/foundry.dashboard';

function renderWidget(widget: DashboardWidget, index: number) {
  switch (widget.kind) {
    case 'pipeline-health':
      return <PipelineHealthWidget key={index} title={widget.title} />;
    case 'source-freshness':
      return <SourceFreshnessWidget key={index} title={widget.title} />;
    case 'delivery-health':
      return <DeliveryHealthWidget key={index} title={widget.title} />;
    case 'attention':
      return <AttentionWidget key={index} title={widget.title} />;
  }
}

export function DashboardHome({ config = dashboardConfig }: { config?: DashboardConfig }) {
  return (
    <DashboardSection title={config.title} description={config.description}>
      <DashboardGrid columns={2} gap="md">
        {config.widgets.map((widget, i) => renderWidget(widget, i))}
      </DashboardGrid>
    </DashboardSection>
  );
}
