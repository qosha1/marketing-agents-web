'use client';

/**
 * One record's history, as a collapsed card, on any surface where a person can
 * edit that record (bd startsim-jkkn7.16).
 *
 * THIS IS NOT A SECOND HISTORY IMPLEMENTATION. The timeline, the fold, the
 * three-state actor vocabulary and the 404-vs-empty distinction are all the
 * shared `RecordHistoryPanel` (@startsimpli/ui/history); the reader is this app's
 * `revisionClient` (lib/revisions.ts), which keeps the tenant's declared field
 * names verbatim. What lives here is the arrangement three surfaces share — the
 * topic header, the topic review drawer and the generic record drawer — so the
 * card chrome and the class overrides are written once rather than three times.
 *
 * COLLAPSED, AND MOUNTED ONLY WHEN OPENED. `CollapsiblePanel` renders its body
 * only while open and the panel fetches on mount, so a drawer stepped through
 * row by row costs no request for a trail nobody expanded.
 *
 * The draft page's Quality rail keeps its own mount: it is CONTROLLED there,
 * because the stale-save dialog's "See what changed" opens it from outside.
 */
import { useMemo } from 'react';
import { RecordHistoryPanel, versionFromRecord } from '@startsimpli/ui/history';

import { CollapsiblePanel, FLATTEN_CARD } from '@/components/draft-review/CollapsiblePanel';
import { revisionsKey } from '@/lib/entity-cache';
import { revisionClient } from '@/lib/revisions';

export interface RecordHistorySectionProps {
  /** The record as the host shows it. Its `version` keys the trail — see `revisionsKey`. */
  record: { id: number | string };
  /** Card title. Name the record when another record's history may sit nearby. */
  title?: string;
  className?: string;
}

export function RecordHistorySection({
  record,
  title = 'History',
  className,
}: RecordHistorySectionProps) {
  const recordId = record.id;
  // Read through the shared helper: the topic header holds the collection
  // package's `EntityRecord`, which does not declare `version`.
  const version = versionFromRecord(record);
  const client = useMemo(() => revisionClient(recordId), [recordId]);
  return (
    <CollapsiblePanel title={title} className={className}>
      <RecordHistoryPanel
        client={client}
        queryKey={revisionsKey(recordId, version)}
        // The card supplies the title and the gutter, so the panel's own are
        // dropped; its DESCRIPTION and its incompleteness note stay — they are
        // what tell the reader the trail is per-field and may be partial.
        classNames={{
          root: FLATTEN_CARD,
          header: 'border-b-0 px-0 pb-3 pt-0',
          title: 'hidden',
          body: 'max-h-[32rem] overflow-y-auto px-0 py-2',
          notice: 'border-b border-border px-0 py-2 text-xs text-muted-foreground',
          countLine: 'border-t border-border px-0 py-2 text-xs text-muted-foreground',
        }}
      />
    </CollapsiblePanel>
  );
}
