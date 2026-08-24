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
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  KanbanBoard,
  type KanbanColumnConfig,
  type KanbanMove,
  notify,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@startsimpli/ui';

import {
  boardColumns,
  choicesOf,
  pickStatusAttr,
  readData,
  toCamelKey,
  UNSET_COLUMN,
  type RollupCounts,
} from '@/lib/board';
import type { LaneState } from '@/lib/lanes';
import { initialsOf } from '@/lib/roster';
import { updateEntity, type Paginated, type EntityRecord, type EntityTypeDef } from '@/lib/foundry-api';

/** Attribute-name convention for the assignee chip (startsim-71z6) — any type
 *  that declares this attr gets the chip, not just topic/draft. */
const ASSIGNEE_NAME_ATTR = 'assignee_name';

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
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      // Ask one card-height early so the next page is usually there by the time
      // the reader reaches the bottom, rather than after a visible stall.
      { rootMargin: '300px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return <div ref={ref} aria-hidden data-testid="lane-load-more-sentinel" className="h-px w-full" />;
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

  const statusCamel = toCamelKey(statusName);

  /**
   * Move a record between two lanes' caches. Both writes happen together so a
   * rollback restores a consistent board rather than a card that is in neither
   * lane or in both.
   */
  const patchLanes = useCallback(
    (record: EntityRecord, from: string, to: string, newStatus: string) => {
      const moved = { ...record, data: { ...record.data, [statusCamel]: newStatus } };
      qc.setQueryData<Paginated<EntityRecord>>(laneKey(from), (old) =>
        old
          ? { ...old, results: old.results.filter((r) => r.id !== record.id), count: Math.max(0, old.count - 1) }
          : old,
      );
      qc.setQueryData<Paginated<EntityRecord>>(laneKey(to), (old) =>
        old ? { ...old, results: [moved, ...old.results], count: old.count + 1 } : old,
      );
    },
    [qc, laneKey, statusCamel],
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
        await updateEntity(record.id, { data: { ...record.data, [statusCamel]: newStatus } });
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
    [qc, laneKey, columns, statusName, statusCamel, patchLanes],
  );

  if (!statusAttr) return null;

  const choices = choicesOf(statusAttr);
  // Assignee gets its OWN dedicated chip (below), never a plain meta row.
  const displayAttrs = type.attributes
    .filter(
      (a) => a.name !== statusName && a.dataType !== 'json' && a.dataType !== 'longtext' && a.name !== ASSIGNEE_NAME_ATTR,
    )
    .slice(0, 3);
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
        return (
          <>
            <div className="m-2 cursor-grab rounded-md border bg-white p-3 shadow-sm active:cursor-grabbing">
              <button
                type="button"
                className="block w-full text-left text-sm font-medium leading-snug hover:underline"
                onClick={() => onCardClick(record)}
              >
                {record.name || record.externalId || `#${record.id}`}
              </button>
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
              <dl className="mt-1 space-y-0.5">
                {displayAttrs.map((a) => {
                  const v = readData(record.data, a.name);
                  if (v == null || v === '') return null;
                  return (
                    <div key={String(a.id)} className="flex gap-1 text-xs text-neutral-600">
                      <dt className="capitalize text-neutral-400">{a.name.replace(/_/g, ' ')}:</dt>
                      <dd className="truncate">{a.dataType === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd>
                    </div>
                  );
                })}
              </dl>
              {/* stop pointerdown so interacting with the select never starts a drag */}
              <div
                className="mt-2"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Select
                  value={String(readData(record.data, statusName) ?? '')}
                  onValueChange={(val) => applyStatus(record, val)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Set status…" />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {sentinelFor ? <LoadMoreSentinel onVisible={() => onLoadMore(sentinelFor)} /> : null}
          </>
        );
      }}
    />
  );
}
