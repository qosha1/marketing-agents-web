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
 * The draft page's History rail keeps its own mount: it is CONTROLLED there,
 * because the stale-save dialog's "See what changed" opens it from outside.
 *
 * RESTORE (bd startsim-vehzd). Every surface that mounts this edits the record
 * through a re-read-then-merge save asserting the version it read, so there is no
 * local editor copy to clobber here — what a restore must refresh is the CACHE:
 * the record's own key (both host pages read the topic from it) and the lists
 * that show it. The precondition is the newer of the version the host shows and
 * the one this tab last saw (lib/record-version.ts), because a drawer's record
 * can be a snapshot older than the registry.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notify } from '@startsimpli/ui';
import { RecordHistoryPanel, versionFromRecord } from '@startsimpli/ui/history';

import { CollapsiblePanel, FLATTEN_CARD } from '@/components/draft-review/CollapsiblePanel';
import { entityKey, revisionsKey } from '@/lib/entity-cache';
import { heldVersion, rememberVersion } from '@/lib/record-version';
import { revisionClient } from '@/lib/revisions';

export interface RecordHistorySectionProps {
  /** The record as the host shows it. Its `version` keys the trail — see `revisionsKey`. */
  record: { id: number | string; permissions?: { canRestore?: boolean } | null };
  /** Card title. Name the record when another record's history may sit nearby. */
  title?: string;
  className?: string;
  /** CONTROLLED open state, for a host whose field attribution opens it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Narrow to one field (`?field=`). */
  field?: string | null;
  onFieldChange?: (field: string | null) => void;
  /** "this topic" — for the restore and stale dialogs. */
  recordLabel?: string;
}

export function RecordHistorySection({
  record,
  title = 'History',
  className,
  open,
  onOpenChange,
  field,
  onFieldChange,
  recordLabel = 'this record',
}: RecordHistorySectionProps) {
  const recordId = record.id;
  const qc = useQueryClient();
  // Read through the shared helper: the topic header holds the collection
  // package's `EntityRecord`, which does not declare `version`.
  const version = versionFromRecord(record);
  const client = useMemo(() => revisionClient(recordId), [recordId]);
  // Uncontrolled hosts can still narrow from inside a row.
  const [ownField, setOwnField] = useState<string | null>(null);
  const narrowed = field !== undefined ? field : ownField;
  const setNarrowed = onFieldChange ?? setOwnField;
  const controlled = open !== undefined ? { open, onOpenChange: onOpenChange ?? (() => {}) } : {};
  return (
    <CollapsiblePanel title={title} className={className} {...controlled}>
      <RecordHistoryPanel
        client={client}
        queryKey={revisionsKey(recordId, version)}
        recordLabel={recordLabel}
        {...(narrowed ? { field: narrowed } : {})}
        // Restoring is editing the record (bd startsim-768w.71).
        canRestore={record.permissions?.canRestore !== false}
        onClearField={() => setNarrowed(null)}
        onNarrowToField={(f) => setNarrowed(f)}
        currentVersion={() => {
          const held = heldVersion(recordId);
          if (version === undefined) return held;
          return held === undefined ? version : Math.max(version, held);
        }}
        onRestored={async (outcome) => {
          rememberVersion(recordId, outcome.record);
          // The record's own key first — both host pages read the topic from it —
          // then every list that shows it.
          await qc.invalidateQueries({ queryKey: entityKey(recordId) });
          await qc.invalidateQueries({ queryKey: ['entities'] });
          notify.success(
            outcome.summary.revision === null
              ? 'Nothing to restore — it already matches that version.'
              : `Restored from v${outcome.summary.restoredFrom}.`,
          );
        }}
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
