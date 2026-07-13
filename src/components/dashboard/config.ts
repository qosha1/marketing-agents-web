/**
 * System-health dashboard config (bd 768w.16.8.5).
 *
 * The home page is a wall of health widgets that bubble up the whole tenant. Each
 * widget is a small, self-contained data-fetcher (see ./widgets); this config just
 * declares WHICH widgets the home lays out and in what order, so the composition is
 * data, not hand-wired JSX. Keep it tiny — a widget is a `kind` + an optional title
 * override; the widget component owns its own query + empty/loading states.
 */

export type DashboardWidgetKind =
  | 'pipeline-health'
  | 'source-freshness'
  | 'delivery-health'
  | 'attention';

interface BaseWidget {
  /** Optional heading override (else the widget's own default title). */
  title?: string;
}

export interface PipelineHealthWidget extends BaseWidget {
  kind: 'pipeline-health';
}
export interface SourceFreshnessWidget extends BaseWidget {
  kind: 'source-freshness';
}
export interface DeliveryHealthWidget extends BaseWidget {
  kind: 'delivery-health';
}
export interface AttentionWidget extends BaseWidget {
  kind: 'attention';
}

/** A single home widget — discriminated by `kind`. */
export type DashboardWidget =
  | PipelineHealthWidget
  | SourceFreshnessWidget
  | DeliveryHealthWidget
  | AttentionWidget;

/** The whole home layout: a titled section over an ordered list of widgets. */
export interface DashboardConfig {
  title: string;
  description?: string;
  widgets: DashboardWidget[];
}
