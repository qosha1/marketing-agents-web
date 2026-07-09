'use client';

/**
 * Generic, schema-driven record drawer (bd ogmc-9ms.1.9; readable detail startsim-768w.17.6).
 * Opens READ-FIRST: renders every declared attribute read-optimized via the shared
 * @startsimpli/ui RecordDetail (long-text bodies as readable prose, urls as links) so a
 * full article is comfortable to read. An "Edit" toggle reveals the editable form
 * (AttributeField widgets) + Save. Preserves non-declared data keys and canonicalizes to
 * the client's camelCase blob so a PATCH (which REPLACES data) never drops fields.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, notify } from '@startsimpli/ui';

import { AttributeField } from './attribute-field';
import { RecordDetail, type RecordField } from './record-detail';
import { readData, toCamelKey } from '@/lib/board';
import { updateEntity, type EntityRecord, type EntityTypeDef } from '@/lib/foundry-api';

interface Props {
  type: EntityTypeDef;
  record: EntityRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EntityDetailDrawer({ type, record, onClose, onSaved }: Props) {
  if (!record) return null;
  return <DrawerInner key={record.id} type={type} record={record} onClose={onClose} onSaved={onSaved} />;
}

function initialValues(type: EntityTypeDef, record: EntityRecord): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const attr of type.attributes) {
    const raw = readData(record.data, attr.name);
    if (attr.dataType === 'json') {
      v[attr.name] = raw == null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    } else {
      v[attr.name] = raw ?? '';
    }
  }
  return v;
}

function readFields(type: EntityTypeDef, record: EntityRecord): RecordField[] {
  return type.attributes.map((attr) => {
    const raw = readData(record.data, attr.name);
    const kind: RecordField['kind'] =
      attr.dataType === 'longtext' ? 'longtext' : attr.dataType === 'json' ? 'json' : 'text';
    let value: string;
    if (raw == null) value = '';
    else if (attr.dataType === 'boolean') value = raw ? 'Yes' : 'No';
    else if (attr.dataType === 'json') value = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    else value = String(raw);
    return { label: attr.name.replace(/_/g, ' '), value, kind };
  });
}

function DrawerInner({
  type,
  record,
  onClose,
  onSaved,
}: {
  type: EntityTypeDef;
  record: EntityRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [name, setName] = useState(record.name || '');
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(type, record));
  const [saving, setSaving] = useState(false);
  const fields = useMemo(() => readFields(type, record), [type, record]);

  async function save() {
    const nextData: Record<string, unknown> = { ...record.data };
    for (const attr of type.attributes) {
      const camel = toCamelKey(attr.name);
      let val = values[attr.name];
      if (attr.dataType === 'json') {
        const s = String(val ?? '').trim();
        if (!s) {
          delete nextData[camel];
          delete nextData[attr.name];
          continue;
        }
        try {
          val = JSON.parse(s);
        } catch {
          notify.error(`"${attr.name}" is not valid JSON.`);
          return;
        }
      }
      if (val === '' || val === undefined || val === null) {
        delete nextData[camel];
        delete nextData[attr.name];
      } else {
        nextData[camel] = val;
        if (camel !== attr.name) delete nextData[attr.name];
      }
    }
    setSaving(true);
    try {
      await updateEntity(record.id, { name: name.trim() || record.name, data: nextData });
      await qc.invalidateQueries({ queryKey: ['entities', type.key] });
      notify.success('Saved.');
      onSaved();
      onClose();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l bg-white shadow-xl">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{type.label}</div>
            <div className="truncate text-sm font-medium">
              {record.name || record.externalId || `#${record.id}`}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setMode((m) => (m === 'read' ? 'edit' : 'read'))}
              className="rounded border px-2.5 py-1 text-xs hover:bg-neutral-50"
            >
              {mode === 'read' ? 'Edit' : 'View'}
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        {mode === 'read' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <RecordDetail fields={fields} emptyMessage="No details captured for this item yet." />
            {record.externalId ? (
              <p className="pt-4 text-xs text-neutral-400">external_id: {record.externalId}</p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {type.attributes.map((attr) => (
                <div key={String(attr.id)} className="space-y-1.5">
                  <Label className="capitalize">{attr.name.replace(/_/g, ' ')}</Label>
                  <AttributeField
                    attr={attr}
                    value={values[attr.name]}
                    onChange={(val) => setValues((prev) => ({ ...prev, [attr.name]: val }))}
                  />
                </div>
              ))}
            </div>
            <footer className="flex gap-2 border-t px-4 py-3">
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <button
                onClick={() => setMode('read')}
                disabled={saving}
                className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
