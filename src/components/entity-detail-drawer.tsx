'use client';

/**
 * Generic, schema-driven record drawer (bd ogmc-9ms.1.9): open any entity, view
 * + edit every declared attribute (reusing AttributeField's data_type→widget
 * mapping), and Save. Works for ANY tenant/type — the OGMC "drafts review" is
 * just this drawer over a `draft` record (its judge_verdict/auto_checks json
 * attrs render as pretty-printed, editable JSON). Preserves non-declared data
 * keys (e.g. _origin) and canonicalizes to the client's camelCase blob so a
 * PATCH (which REPLACES data) never drops fields.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, notify } from '@startsimpli/ui';

import { AttributeField } from './attribute-field';
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
  // key remounts (resets form state) whenever a different record opens
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
  const [name, setName] = useState(record.name || '');
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(type, record));
  const [saving, setSaving] = useState(false);

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
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-hidden border-l bg-white shadow-xl">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{type.label}</div>
            <div className="truncate text-sm font-medium">
              {record.name || record.externalId || `#${record.id}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

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
          {record.externalId ? (
            <p className="pt-2 text-xs text-neutral-400">external_id: {record.externalId}</p>
          ) : null}
        </div>

        <footer className="flex gap-2 border-t px-4 py-3">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </footer>
      </aside>
    </div>
  );
}
