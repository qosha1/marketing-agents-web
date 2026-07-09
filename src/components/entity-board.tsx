'use client';

/**
 * Generic, schema-driven status board (bd ogmc-9ms.1.7; drag-and-drop startsim-768w.17.5).
 * Lays out any entity type that has an enum attribute (preferring "status") as kanban
 * lanes. Move a record by DRAGGING it between lanes — the drag + keyboard-drag mechanics
 * live entirely in @startsimpli/ui (KanbanBoard); this component only supplies the data
 * and persists the move (the per-card status select stays as a fallback). Either path
 * PATCHes the full data blob (the backend PATCH replaces data, so we always send
 * {...record.data, [status]: value}), optimistically moving the card and rolling back on error.
 */
import { useMemo } from 'react';
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
  groupByStatus,
  pickStatusAttr,
  readData,
  toCamelKey,
  UNSET_COLUMN,
} from '@/lib/board';
import { updateEntity, type EntityRecord, type EntityTypeDef } from '@/lib/foundry-api';

interface Props {
  type: EntityTypeDef;
  records: EntityRecord[];
  onCardClick: (record: EntityRecord) => void;
}

/** Renders null when the type has no status enum — the page falls back to the table. */
export function EntityBoard({ type, records, onCardClick }: Props) {
  const qc = useQueryClient();
  const statusAttr = useMemo(() => pickStatusAttr(type), [type]);
  const columns = useMemo(() => boardColumns(statusAttr), [statusAttr]);
  const statusName = statusAttr?.name ?? '';
  const items = useMemo(
    () => groupByStatus(records, statusName, columns),
    [records, statusName, columns],
  );

  if (!statusAttr) return null;

  const choices = choicesOf(statusAttr);
  const statusCamel = toCamelKey(statusName);
  const displayAttrs = type.attributes
    .filter((a) => a.name !== statusName && a.dataType !== 'json' && a.dataType !== 'longtext')
    .slice(0, 3);
  const kanbanCols: KanbanColumnConfig[] = columns.map((c) => ({ id: c.id, label: c.label }));
  const boardKey = ['entities', type.key, 'all'];

  async function applyStatus(record: EntityRecord, newStatus: string) {
    if (String(readData(record.data, statusName) ?? '') === newStatus) return;
    const prev = qc.getQueryData<EntityRecord[]>(boardKey);
    // optimistic: move the card into its new lane immediately, roll back on failure
    qc.setQueryData<EntityRecord[]>(boardKey, (old) =>
      old?.map((r) =>
        r.id === record.id ? { ...r, data: { ...r.data, [statusCamel]: newStatus } } : r,
      ),
    );
    try {
      await updateEntity(record.id, { data: { ...record.data, [statusCamel]: newStatus } });
      await qc.invalidateQueries({ queryKey: ['entities', type.key] });
    } catch (err) {
      if (prev) qc.setQueryData(boardKey, prev);
      notify.error(err instanceof Error ? err.message : 'Could not update status.');
    }
  }

  function handleMove(move: KanbanMove) {
    if (move.toColumnId === UNSET_COLUMN.id) return; // dragging into "Unset" is a no-op
    const record = records.find((r) => String(r.id) === move.cardId);
    if (record) void applyStatus(record, move.toColumnId);
  }

  return (
    <KanbanBoard<EntityRecord>
      columns={kanbanCols}
      items={items}
      columnWidth={300}
      emptyColumnMessage="—"
      getCardId={(record) => String(record.id)}
      onCardMove={handleMove}
      renderColumnHeader={(col, colItems) => (
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium capitalize">
            {col.id === UNSET_COLUMN.id ? 'Unset' : col.label}
          </span>
          <span className="rounded-full bg-neutral-200 px-2 text-xs text-neutral-700">
            {colItems.length}
          </span>
        </div>
      )}
      renderCard={(record) => (
        <div className="m-2 cursor-grab rounded-md border bg-white p-3 shadow-sm active:cursor-grabbing">
          <button
            type="button"
            className="block w-full text-left text-sm font-medium leading-snug hover:underline"
            onClick={() => onCardClick(record)}
          >
            {record.name || record.externalId || `#${record.id}`}
          </button>
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
      )}
    />
  );
}
