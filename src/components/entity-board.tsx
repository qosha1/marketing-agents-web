'use client';

/**
 * Generic, schema-driven status board (bd ogmc-9ms.1.7; drag-and-drop startsim-768w.17.5).
 * Lays out any entity type that has an enum attribute (preferring "status") as kanban
 * lanes. Move a record by DRAGGING it between lanes — the drag + keyboard-drag mechanics
 * live entirely in @startsimpli/ui (KanbanBoard); this component only supplies the data
 * and persists the move (the per-card status select stays as a fallback).
 *
 * EACH LANE IS ITS OWN PAGE OF RECORDS (bd startsim-wn2p.27). The board no longer
 * receives one list to group: it receives a lane at a time, already fetched by
 * that lane's own query, plus the lane's TRUE size from the server. Two things
 * follow, and both are the point:
 *
 *  - The header badge counts what EXISTS, not what loaded. A rejected lane reads
 *    808 while holding 50 cards. That is the honest number — the alternative is a
 *    badge that silently means "50 so far" and looks identical to a lane of 50.
 *  - Scrolling a lane to its end asks for that lane's next page. The sentinel
 *    rides the last card because @startsimpli/ui renders `renderColumnFooter`
 *    OUTSIDE the scroll container, where it would be permanently visible and fire
 *    forever. Lifting a proper in-scroll footer into the package is wn2p.27's
 *    follow-up; it is not worth a publish cycle to avoid four lines here.
 *
 * Either move path PATCHes the full data blob (the backend PATCH replaces data, so we
 * always send {...record.data, [status]: value}), optimistically moving the card between
 * the two lanes' caches and rolling both back on error.
 *
 * A CARD DOES NOT REPEAT WHAT THE BOARD ALREADY SAYS (bd startsim-8hgmq.5). The
 * lane it sits in, the tab it was reached under, and its own heading are all on
 * screen already; what a card body has left to say is lib/board-card.ts's
 * `cardBody`, a pure rule that names no attribute. The per-card status control
 * survives that cleanup because it is the only way to reach a lane the ✕/✓/✎
 * cluster does not cover — it just stopped displaying the lane it is already in.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  KanbanBoard,
  type KanbanColumnConfig,
  type KanbanMove,
  notify,
} from '@startsimpli/ui';

import { InlineReviewActions, type ReviewConfig } from '@startsimpli/ui/collection';

import {
  boardColumns,
  laneMoveData,
  pickStatusAttr,
  readData,
  UNSET_COLUMN,
  type AttrFilter,
  type RollupCounts,
} from '@/lib/board';
import { ASSIGNEE_NAME_ATTR, cardBody } from '@/lib/board-card';
import { nearestScrollParent, type LaneState } from '@/lib/lanes';
import { initialsOf } from '@/lib/roster';
import {
  collectionClient,
  type Paginated,
  type EntityRecord,
  type EntityTypeDef,
} from '@/lib/foundry-api';
import { saveEntity } from '@/lib/entity-cache';

interface Props {
  type: EntityTypeDef;
  /** One entry per lane id. A lane with no entry renders empty. */
  lanes: Record<string, LaneState>;
  /** Ask this lane for its next page. Called once per arrival at the lane's end. */
  onLoadMore: (laneId: string) => void;
  /**
   * The react-query key of a lane's FIRST page — where an optimistic move lands.
   * First page because that is where the backend would put a just-touched record
   * anyway: lanes are ordered newest-first and the move is what makes it newest.
   */
  laneKey: (laneId: string) => readonly unknown[];
  onCardClick: (record: EntityRecord) => void;
  /**
   * Optional child-status rollup per record id (startsim-4w76/n7s8), e.g. a
   * topic's linked drafts bucketed by status. EntityBoard stays generic — it
   * has no idea what a "draft" is — so the caller computes this (typically via
   * lib/board.ts's rollupByParent) and hands it in; a record with no entry
   * renders no chip at all, so a type with nothing to roll up is unchanged.
   */
  rollupById?: Map<EntityRecord['id'], RollupCounts>;
  /** Turns one record's rollup counts into the chip text, e.g. "2/3 ready". */
  rollupLabel?: (counts: RollupCounts) => string | null;
  /**
   * Records no lane query can reach — a status that is blank, or not a declared
   * choice. Arrived at by subtraction (lib/lanes.ts `unaccountedFor`) because no
   * filter can express it. Shown in the Unset lane so it is never a silent zero.
   */
  unaccounted?: number;
  /**
   * The review field-map for this type. PASSING IT IS WHAT PUTS THE DECISION
   * CLUSTER ON EVERY CARD (bd startsim-6y458) — the same ✕ / ✓ / ✎ buttons the
   * table's Actions column renders, over the same shared `InlineReviewActions`,
   * so Approve means the same coherent status+verdict write on both surfaces.
   * Omit it and the board is exactly what it was: lanes, a drag, and a per-card
   * status select. The caller supplies the object (see lib/review-vocabulary.ts)
   * rather than the board deriving one, because only the caller knows which of
   * its types are reviewable and what its decisions are ABOUT.
   */
  review?: ReviewConfig;
  /**
   * The enum facets the board is ALREADY SCOPED BY — the page's applied filters
   * (`boardAttrFilters(...).applied`), handed straight through. A card does not
   * repeat what the tab and the header chip above it already say: under the
   * Evergreen tab every card is `lead_magnet`, so that row is suppressed
   * (bd startsim-8hgmq.5). Derived from the filter, never from an attribute
   * name — a `deal` board scoped by `?region=emea` gets the same for free, and
   * an unscoped board keeps the row, where it tells the kinds apart.
   */
  pinned?: readonly AttrFilter[];
  /**
   * Fired after a decision is saved from a card, so the page can refetch. A
   * decision moves the record to another lane and changes two lanes' counts,
   * and only the server knows where it landed — see the board page's handler.
   */
  onDecided?: (record: EntityRecord) => void;
}

/**
 * Fires `onVisible` when it scrolls into view. No-ops where there is no
 * IntersectionObserver (SSR, older jsdom), so a lane still loads its first page
 * and the explicit button below it still works. Mirrors the house pattern in
 * @startsimpli/ui's ActivityTimeline.
 */
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The callback is kept in a ref and refreshed in an EFFECT, not during render:
  // the observer is created once and must call today's `onVisible`, but writing
  // a ref while rendering is the bug React's refs rule is about.
  const cb = useRef(onVisible);
  useEffect(() => {
    cb.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    // Rooted at the LANE, not the viewport. `rootMargin` grows the root's rect,
    // never the clip rect of a scrolling ancestor — so a viewport-rooted
    // observer left this sentinel permanently invisible at the lane's bottom
    // edge and the board only ever loaded more via the button. See
    // nearestScrollParent for the measurement.
    const root = nearestScrollParent<HTMLElement>(node, (el) => getComputedStyle(el).overflowY);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      // Ask a few cards early so the next page is usually there by the time the
      // reader reaches the bottom, rather than after a visible stall.
      { root, rootMargin: '400px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // Tall enough to be unambiguously inside the lane rather than balanced on its
  // bottom edge, short enough to read as nothing.
  return <div ref={ref} aria-hidden data-testid="lane-load-more-sentinel" className="h-2 w-full" />;
}

/** Renders null when the type has no status enum — the page falls back to the table. */
export function EntityBoard({
  type,
  lanes,
  onLoadMore,
  laneKey,
  onCardClick,
  rollupById,
  rollupLabel,
  unaccounted = 0,
  review,
  pinned,
  onDecided,
}: Props) {
  const qc = useQueryClient();
  const statusAttr = useMemo(() => pickStatusAttr(type), [type]);
  const columns = useMemo(() => boardColumns(statusAttr), [statusAttr]);
  const statusName = statusAttr?.name ?? '';

  const items = useMemo(() => {
    const out: Record<string, EntityRecord[]> = {};
    for (const c of columns) out[c.id] = lanes[c.id]?.records ?? [];
    return out;
  }, [columns, lanes]);

  /**
   * The id of the last card in each lane — where that lane's sentinel goes.
   * Keyed by card id rather than by index because `renderCard` is handed an
   * item, not its position.
   */
  const sentinelIds = useMemo(() => {
    const out = new Map<string, string>(); // cardId -> laneId
    for (const c of columns) {
      const recs = lanes[c.id]?.records ?? [];
      const last = recs[recs.length - 1];
      if (last && lanes[c.id]?.hasMore) out.set(String(last.id), c.id);
    }
    return out;
  }, [columns, lanes]);

  /**
   * Move a record between two lanes' caches. Both writes happen together so a
   * rollback restores a consistent board rather than a card that is in neither
   * lane or in both.
   */
  const patchLanes = useCallback(
    (record: EntityRecord, from: string, to: string, newStatus: string) => {
      const moved = { ...record, data: laneMoveData(record.data, statusName, newStatus) };
      qc.setQueryData<Paginated<EntityRecord>>(laneKey(from), (old) =>
        old
          ? { ...old, results: old.results.filter((r) => r.id !== record.id), count: Math.max(0, old.count - 1) }
          : old,
      );
      qc.setQueryData<Paginated<EntityRecord>>(laneKey(to), (old) =>
        old ? { ...old, results: [moved, ...old.results], count: old.count + 1 } : old,
      );
    },
    [qc, laneKey, statusName],
  );

  const applyStatus = useCallback(
    async (record: EntityRecord, newStatus: string) => {
      const current = String(readData(record.data, statusName) ?? '');
      if (current === newStatus) return;
      const from = columns.some((c) => c.id === current) ? current : UNSET_COLUMN.id;
      const prevFrom = qc.getQueryData<Paginated<EntityRecord>>(laneKey(from));
      const prevTo = qc.getQueryData<Paginated<EntityRecord>>(laneKey(newStatus));
      patchLanes(record, from, newStatus, newStatus);
      try {
        // Status only, on purpose — laneMoveData carries the reasoning. Written
        // through `saveEntity` so ['entity', <id>] stays in step with the lanes:
        // refreshing only the two lanes left the record's OWN entry holding the
        // pre-drag status for five minutes, so opening the card right after a
        // drag showed it back in the lane it came from (bd startsim-mk5qp).
        await saveEntity(qc, record.id, {
          data: laneMoveData(record.data, statusName, newStatus),
        });
        // Re-fetch BOTH lanes rather than the whole board. Dropping the trailing
        // ['page', n] segment invalidates EVERY page of the lane, not only the
        // one that was patched: removing a record shifts every later page up by
        // one, so a lane scrolled past page 1 would otherwise show a duplicate.
        await qc.invalidateQueries({ queryKey: laneKey(from).slice(0, -2) });
        await qc.invalidateQueries({ queryKey: laneKey(newStatus).slice(0, -2) });
      } catch (err) {
        if (prevFrom) qc.setQueryData(laneKey(from), prevFrom);
        if (prevTo) qc.setQueryData(laneKey(newStatus), prevTo);
        notify.error(err instanceof Error ? err.message : 'Could not update status.');
      }
    },
    [qc, laneKey, columns, statusName, patchLanes],
  );

  if (!statusAttr) return null;

  const kanbanCols: KanbanColumnConfig[] = columns.map((c) => ({ id: c.id, label: c.label }));

  function handleMove(move: KanbanMove) {
    if (move.toColumnId === UNSET_COLUMN.id) return; // dragging into "Unset" is a no-op
    const record = (lanes[move.fromColumnId]?.records ?? []).find((r) => String(r.id) === move.cardId);
    if (record) void applyStatus(record, move.toColumnId);
  }

  return (
    <KanbanBoard<EntityRecord>
      columns={kanbanCols}
      items={items}
      columnWidth={300}
      emptyColumnMessage="—"
      // A bounded height is what makes each column's own `overflow-y-auto` do
      // anything: without it the PAGE scrolls and every lane renders full height,
      // which is the behaviour this issue is about.
      className="max-h-[calc(100vh-15rem)] min-h-[24rem] items-stretch"
      getCardId={(record) => String(record.id)}
      onCardMove={handleMove}
      renderColumnHeader={(col) => {
        const lane = lanes[col.id];
        const isUnset = col.id === UNSET_COLUMN.id;
        const total = isUnset ? unaccounted : (lane?.count ?? 0);
        const loaded = isUnset ? 0 : (lane?.records.length ?? 0);
        return (
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="truncate text-sm font-medium capitalize">
              {isUnset ? 'Unset' : col.label}
            </span>
            <span
              className="shrink-0 rounded-full bg-neutral-200 px-2 text-xs text-neutral-700"
              // The badge is the SERVER total; say so on hover, because a lane
              // showing 808 over 50 cards is otherwise easy to read as a bug.
              title={
                isUnset
                  ? 'Records whose status is blank or not a declared value'
                  : `${loaded.toLocaleString()} of ${total.toLocaleString()} loaded`
              }
            >
              {total.toLocaleString()}
            </span>
          </div>
        );
      }}
      renderColumnFooter={(col) => {
        const lane = lanes[col.id];
        if (col.id === UNSET_COLUMN.id) {
          return unaccounted > 0 ? (
            <span className="text-[11px] text-neutral-500">
              {unaccounted.toLocaleString()} with an unrecognised status — open the table to see them
            </span>
          ) : null;
        }
        if (lane?.loading) return <span className="text-[11px] text-neutral-400">Loading…</span>;
        if (!lane?.hasMore) return null;
        return (
          <button
            type="button"
            onClick={() => onLoadMore(col.id)}
            className="text-[11px] text-primary-700 hover:underline"
          >
            Load {Math.min(50, Math.max(0, lane.count - lane.records.length)).toLocaleString()} more
          </button>
        );
      }}
      renderCard={(record) => {
        // Assignee-initials chip (startsim-71z6) and draft-progress rollup chip
        // (startsim-4w76/n7s8) — the same "small chip" treatment as the filter
        // badges elsewhere in this app; only rendered when there's something to
        // show, so a record/type with neither is unchanged.
        const assigneeVal = readData(record.data, ASSIGNEE_NAME_ATTR);
        const assigneeInitials =
          assigneeVal != null && String(assigneeVal).trim() ? initialsOf(String(assigneeVal)) : '';
        const rollupCounts = rollupById?.get(record.id);
        const rollupText = rollupCounts && rollupLabel ? rollupLabel(rollupCounts) : null;
        const sentinelFor = sentinelIds.get(String(record.id));
        // WHAT THIS CARD HAS LEFT TO SAY. The lane it sits in, the tab above it,
        // and its own heading are all already on screen; lib/board-card.ts is
        // the pure rule for what is not (bd startsim-8hgmq.5). Selection only —
        // it writes nothing, so a lane move is untouched by it.
        const body = cardBody(type, record, { statusName, pinned });
        return (
          <>
            <div className="m-2 cursor-grab rounded-md border bg-white p-3 shadow-sm active:cursor-grabbing">
              <button
                type="button"
                className="block w-full text-left text-sm font-medium leading-snug hover:underline"
                onClick={() => onCardClick(record)}
              >
                {body.heading}
              </button>
              {/* The line that says what this record is ABOUT — the stacked
                  subtitle the table's Title cell already had. Two lines at most:
                  a card is a card. */}
              {body.subtitle ? (
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-500">{body.subtitle}</p>
              ) : null}
              {assigneeInitials || rollupText ? (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {assigneeInitials ? (
                    <span
                      title={String(assigneeVal)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-200 text-[9px] font-medium text-neutral-700"
                    >
                      {assigneeInitials}
                    </span>
                  ) : null}
                  {rollupText ? (
                    <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                      {rollupText}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {body.rows.length ? (
                <dl className="mt-1 space-y-0.5">
                  {body.rows.map((row) => (
                    <div key={row.name} className="flex gap-1 text-xs text-neutral-600">
                      <dt className="capitalize text-neutral-400">{row.label}:</dt>
                      <dd className="truncate">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {/* stop pointerdown so interacting with a control never starts a drag */}
              <div
                className="mt-2 flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {/*
                  NO STATUS CONTROL HERE, ON PURPOSE (bd startsim-8hgmq.12).
                  Moving a card between lanes is what the board IS — dragging is
                  the mechanism, and every declared status has a lane of its own,
                  so a dropdown reached nothing a drag does not. It first showed
                  the record's status inside the lane of the same name, then read
                  "Move to…"; both were a second way to do the thing the reader is
                  already dragging. What stays is the DECISION, which a drag
                  cannot express: approve writes status AND team_verdict together.
                */}
                {/*
                  The decision, on the card (bd startsim-6y458). The SAME shared
                  cluster the table's Actions column renders, over the same
                  config, so Approve writes the same coherent status+verdict pair
                  on both surfaces. It stops click propagation itself; the
                  pointerdown guard is this wrapper's, because without it a press
                  on a button starts a card drag instead.
                */}
                {review ? (
                  <InlineReviewActions
                    client={collectionClient}
                    type={type}
                    record={record}
                    config={review}
                    onSaved={() => onDecided?.(record)}
                  />
                ) : null}
              </div>
            </div>
            {sentinelFor ? <LoadMoreSentinel onVisible={() => onLoadMore(sentinelFor)} /> : null}
          </>
        );
      }}
    />
  );
}
