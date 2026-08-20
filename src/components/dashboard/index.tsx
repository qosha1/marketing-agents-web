'use client';

/**
 * DashboardHome — the tenant home (bd 768w.16.8.5).
 *
 * Lays the declared health widgets (foundry.dashboard config) into a band so the
 * home bubbles up the whole system at a glance: what needs a human, the shape of
 * the content pipeline, and whether ingestion is still running. The composition is
 * data-driven — add/reorder widgets in src/foundry.dashboard.ts, not here.
 *
 * LAYOUT NOTE (bd startsim-hfc4, the "large blank left panel"): CSS grid items
 * default to `align-items: stretch`, and HealthCard has no intrinsic height cap, so
 * the TALLEST card in a row silently sets the height of every card beside it and the
 * short one pads the difference with nothing. That is a structural trap, not a
 * styling accident, so it gets a structural fix on top of removing the tall card:
 *   - `items-start` — every card is its own content height, full stop;
 *   - per-widget `width` — the queue takes the whole band, so no single card in a
 *     2-up strip can dictate another's height in the first place.
 */
import { DashboardGrid, DashboardSection } from '@startsimpli/ui';

import {
  DEFAULT_WIDGET_WIDTH,
  type DashboardConfig,
  type DashboardWidget,
} from '@/components/dashboard/config';
import {
  AttentionWidget,
  IngestionWidget,
  PipelineHealthWidget,
} from '@/components/dashboard/widgets';
import { dashboardConfig } from '@/foundry.dashboard';

function renderWidget(widget: DashboardWidget) {
  switch (widget.kind) {
    case 'pipeline-health':
      return <PipelineHealthWidget title={widget.title} />;
    case 'ingestion':
      return <IngestionWidget title={widget.title} />;
    case 'attention':
      return <AttentionWidget title={widget.title} />;
  }
}

export function DashboardHome({ config = dashboardConfig }: { config?: DashboardConfig }) {
  return (
    <DashboardSection title={config.title} description={config.description}>
      <DashboardGrid columns={2} gap="md" className="items-start">
        {config.widgets.map((widget, i) => {
          const width = widget.width ?? DEFAULT_WIDGET_WIDTH[widget.kind];
          return (
            <div key={`${widget.kind}-${i}`} className={width === 'full' ? 'lg:col-span-2' : undefined}>
              {renderWidget(widget)}
            </div>
          );
        })}
      </DashboardGrid>
    </DashboardSection>
  );
}
