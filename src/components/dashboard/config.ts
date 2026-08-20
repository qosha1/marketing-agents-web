/**
 * System-health dashboard config (bd 768w.16.8.5).
 *
 * The home page is a band of health widgets that bubble up the whole tenant. Each
 * widget is a small, self-contained data-fetcher (see ./widgets); this config just
 * declares WHICH widgets the home lays out, in what order, and how wide, so the
 * composition is data, not hand-wired JSX. Keep it tiny — a widget is a `kind` plus
 * an optional title/width override; the widget component owns its own query +
 * empty/loading states.
 *
 * Two kinds were REMOVED rather than fixed (bd startsim-hfc4 / startsim-xz0a):
 *   - `source-freshness` — 55 rows, 44 of them permanently "never", and the only
 *     card with no height cap, so it dictated the row height of the whole grid.
 *     Replaced by `ingestion`, a one-line aggregate.
 *   - `delivery-health` — `topic.scheduled_for` is set on 0 of 41 topics and
 *     `delivered_at` on 0, so the card renders "Nothing scheduled yet" and always
 *     will. DeliveryHealth stays in @startsimpli/ui for a fork that does schedule.
 */

export type DashboardWidgetKind = 'pipeline-health' | 'ingestion' | 'attention';

/** How much of the grid a widget claims. `full` spans every column. */
export type DashboardWidgetWidth = 'full' | 'half';

interface BaseWidget {
  /** Optional heading override (else the widget's own default title). */
  title?: string;
  /** Optional span override (else the widget's own default width). */
  width?: DashboardWidgetWidth;
}

export interface PipelineHealthWidget extends BaseWidget {
  kind: 'pipeline-health';
}
export interface IngestionWidget extends BaseWidget {
  kind: 'ingestion';
}
export interface AttentionWidget extends BaseWidget {
  kind: 'attention';
}

/** A single home widget — discriminated by `kind`. */
export type DashboardWidget = PipelineHealthWidget | IngestionWidget | AttentionWidget;

/** The whole home layout: a titled section over an ordered list of widgets. */
export interface DashboardConfig {
  title: string;
  description?: string;
  widgets: DashboardWidget[];
}

/** Widths a widget claims unless the config overrides them. */
export const DEFAULT_WIDGET_WIDTH: Record<DashboardWidgetKind, DashboardWidgetWidth> = {
  // The queue is what the reader came for — it gets the full band, above the fold.
  attention: 'full',
  'pipeline-health': 'half',
  ingestion: 'half',
};
