'use client';

/**
 * HistoryRail — the right-hand rail of the draft page: the record's history.
 *
 * It was the QualityRail. The Checks / AI judge / validation section, the
 * Approve draft / Reject draft decision and Notes were removed from it (bd
 * startsim-m7fdm.25, Quinn 2026-10-08: the checks section "does nothing and is
 * confusing and poorly designed"; the decision and Notes went in the same
 * pass). Nothing stored on a draft was rewritten: judge_verdict, review
 * (verdict, scores, overallNote), notes and override_reason stay on the record.
 * Quinn kept History ("history of the doc is important it should just be built
 * into the view better"); building it into the view is a separate follow-up.
 *
 *   • History — WHO changed WHICH FIELD, from what to what, and whether a
 *     machine did it (bd startsim-j19hf). This is the SHARED
 *     `RecordHistoryPanel` from `@startsimpli/ui/history` over the server-side
 *     revision trail (bd startsim-o1qib), mounted with this app's authed reader.
 *     Nothing here folds, diffs or decides an actor kind: the shared panel owns
 *     all three, including the three-state `actor_kind` whose `unknown` must
 *     never read as "a machine did this".
 *   • Revision history — lineage chips + on-demand blog diff, for drafts the
 *     removed AI rewrite created (`revised_from`).
 *
 * Presentational — all state + persistence stay in the draft page. Fork-local.
 */
import * as React from 'react';
import Link from 'next/link';

import { DiffViewer } from '@startsimpli/ui';
import {
  RecordHistoryPanel,
  type RecordHistoryPanelProps,
  type RevisionClient,
} from '@startsimpli/ui/history';

import type { EntityRecord } from '@/lib/foundry-api';
import { CollapsiblePanel, FLATTEN_CARD } from './CollapsiblePanel';

export interface HistoryRailProps {
  /** May the caller change this draft (its `permissions.canEdit`, bd
   *  startsim-768w.71)? False hides restore; reading stays. Defaults to true. */
  canEdit?: boolean;

  /**
   * The authed reader for THIS draft's revision trail (bd startsim-j19hf). The
   * panel pages it server-side and folds the autosave bursts itself — nothing
   * about the trail is held in this component or in the page above it.
   */
  revisions: RevisionClient;
  /** Whether the history panel is open. CONTROLLED, because the stale-save
   *  dialog's safe default action has to be able to open it from outside. */
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  /** The panel narrowed to one field (`?field=`), set by a field's "edited by"
   *  line. Null or absent shows every field. */
  historyField?: string | null;
  onHistoryFieldChange?: (field: string | null) => void;
  /** RESTORE (bd startsim-vehzd), straight through to the shared panel. Absent,
   *  the panel offers no restore. */
  currentVersion?: RecordHistoryPanelProps['currentVersion'];
  beforeRestore?: RecordHistoryPanelProps['beforeRestore'];
  onRestored?: RecordHistoryPanelProps['onRestored'];

  // Revision history
  chain: EntityRecord[];
  currentId: string;
  parentId: string;
  showDiff: boolean;
  onToggleDiff: () => void;
  blogDiff: string;
  parentLoading: boolean;
  parentError: boolean;
  onRefreshParent: () => void;
}

export function HistoryRail(props: HistoryRailProps) {
  const {
    revisions,
    historyOpen,
    onHistoryOpenChange,
    historyField,
    onHistoryFieldChange,
    currentVersion: heldVersion,
    beforeRestore,
    onRestored,
    chain,
    currentId,
    parentId,
    showDiff,
    onToggleDiff,
    blogDiff,
    parentLoading,
    parentError,
    onRefreshParent,
  } = props;

  const currentVersion = Math.max(1, chain.findIndex((d) => String(d.id) === currentId) + 1);
  const hasHistory = chain.length > 1 || !!parentId;
  const mayEdit = props.canEdit !== false;

  return (
    <div className="flex flex-col gap-3">
      {/* History — who changed which field, from what to what (bd startsim-j19hf).
          CONTROLLED so the stale-save dialog can open it; `defaultOpen` would
          leave the dialog's "See what changed" with nothing to reveal. */}
      <CollapsiblePanel title="History" open={historyOpen} onOpenChange={onHistoryOpenChange}>
        {/* Mounted only while open: the panel fetches on mount, so an
            always-mounted trail would cost a request per draft opened for a
            card nobody expanded. */}
        {historyOpen ? (
          <RecordHistoryPanel
            client={revisions}
            queryKey={['entity', currentId, 'revisions']}
            recordLabel="this draft"
            {...(historyField ? { field: historyField } : {})}
            {...(onHistoryFieldChange
              ? {
                  onClearField: () => onHistoryFieldChange(null),
                  onNarrowToField: (f: string) => onHistoryFieldChange(f),
                }
              : {})}
            {...(heldVersion !== undefined ? { currentVersion: heldVersion } : {})}
            {...(beforeRestore ? { beforeRestore } : {})}
            {...(onRestored ? { onRestored } : {})}
            canRestore={mayEdit}
            // The rail's own card and heading supply the chrome, so the panel's
            // title is hidden rather than repeated. Its DESCRIPTION stays: it is
            // what tells the reader this trail is per-field, not per-save.
            // `incompleteNote` and `historyEnabled` are left at the shared
            // defaults — a fork must not decide the trail looks more complete
            // than it is, and since @startsimpli/ui reads the declared-off
            // policy off the revisions envelope itself (bd startsim-jkkn7.17),
            // passing it here would only be a second, staler copy.
            // `px-0` on both: the CollapsiblePanel already supplies the gutter,
            // and the panel's own would cost 40px of a ~370px rail. Since
            // @startsimpli/ui 0.4.141 the per-field before/after split sizes on
            // its CONTAINER and stacks here (bd startsim-jkkn7.12).
            classNames={{
              root: FLATTEN_CARD,
              header: 'border-b-0 px-0 pb-3 pt-0',
              title: 'hidden',
              body: 'max-h-[32rem] overflow-y-auto px-0 py-2',
              notice: 'border-b border-border px-0 py-2 text-xs text-muted-foreground',
              countLine: 'border-t border-border px-0 py-2 text-xs text-muted-foreground',
            }}
          />
        ) : null}
      </CollapsiblePanel>

      {/* Revision history — lineage chips + on-demand blog diff. */}
      {hasHistory ? (
        <CollapsiblePanel
          title="Revision history"
          badge={<span className="font-mono text-xs text-neutral-500">v{currentVersion}</span>}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ol className="flex flex-wrap items-center gap-2 text-sm">
                {chain.map((d, i) => {
                  const isCurrent = String(d.id) === currentId;
                  return (
                    <li key={d.id} className="flex items-center gap-2">
                      {i > 0 ? <span className="text-neutral-300">→</span> : null}
                      {isCurrent ? (
                        <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white">
                          v{i + 1} (this)
                        </span>
                      ) : (
                        <Link
                          href={`/draft/${d.id}`}
                          className="rounded-full border px-2.5 py-0.5 text-xs text-neutral-600 hover:text-neutral-900"
                        >
                          v{i + 1}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
              {parentId ? (
                <button
                  type="button"
                  onClick={onToggleDiff}
                  className="text-xs font-medium text-neutral-600 underline hover:text-neutral-900"
                >
                  {showDiff ? 'Hide diff' : 'Compare to previous'}
                </button>
              ) : null}
            </div>
            {parentId && showDiff ? (
              <div className="h-[420px] overflow-hidden rounded-lg border">
                <DiffViewer
                  diff={blogDiff}
                  baseRef={`previous version (draft #${parentId})`}
                  isLoading={parentLoading}
                  error={parentError ? 'Could not load the previous version.' : null}
                  onRefresh={onRefreshParent}
                  emptyLabel="No changes to the blog vs the previous version"
                />
              </div>
            ) : null}
          </div>
        </CollapsiblePanel>
      ) : null}
    </div>
  );
}
