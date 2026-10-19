'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, notify } from '@startsimpli/ui';
import { AttributeField } from './attribute-field';
import { AssigneePicker, ASSIGNEE_SUB_ATTR } from './entity-detail-drawer';
import { hasTitleAttr, isSystemAttr, TITLE_ATTR } from './record-columns';
import { ASSIGNEE_NAME_ATTR } from '@/lib/board-card';
import { createEntity, type EntityTypeDef } from '@/lib/foundry-api';

interface RecordFormProps {
  type: EntityTypeDef;
  /** Called after a successful create — e.g. to close the dialog it lives in. */
  onSuccess?: () => void;
  /** Called when the user cancels (renders a Cancel button when provided). */
  onCancel?: () => void;
  /** Values the form opens with — e.g. the Kind of the list it was opened
   *  from, so a topic added on Weekly Briefs lands in Weekly Briefs. */
  defaults?: Record<string, unknown>;
}

/**
 * Metadata-driven create form: renders one AttributeField per declared
 * attribute, plus the always-present record Name. Bare (no Card) so it drops
 * cleanly into a dialog; the tall body scrolls so a many-field type never
 * overflows the viewport.
 */
export function RecordForm({ type, onSuccess, onCancel, defaults }: RecordFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [nameMissing, setNameMissing] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...defaults }));
  const [saving, setSaving] = useState(false);
  const hasAssigneePair =
    type.attributes.some((a) => a.name === ASSIGNEE_SUB_ATTR) &&
    type.attributes.some((a) => a.name === ASSIGNEE_NAME_ATTR);
  // Name is the title (`title` copies it), the assignee pair is one roster
  // picker, and `_`-keys are the pipeline's own (bd startsim-umlou, startsim-m27hp).
  const shown = type.attributes.filter(
    (a) =>
      a.name !== TITLE_ATTR &&
      !isSystemAttr(a.name) &&
      !(hasAssigneePair && a.name === ASSIGNEE_NAME_ATTR),
  );

  function setValue(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      // Said at the field, not in a toast across the screen (bd startsim-44uah).
      setNameMissing(true);
      return;
    }

    // Build the data blob, coercing json fields from text and dropping blanks.
    const data: Record<string, unknown> = {};
    for (const attr of type.attributes) {
      const raw = values[attr.name];
      if (attr.name === TITLE_ATTR) continue;
      if (raw === undefined || raw === '') continue;
      if (attr.dataType === 'json') {
        try {
          data[attr.name] = JSON.parse(String(raw));
        } catch {
          notify.error(`"${attr.name}" is not valid JSON.`);
          return;
        }
      } else {
        data[attr.name] = raw;
      }
    }

    if (hasTitleAttr(type)) data[TITLE_ATTR] = name.trim();

    setSaving(true);
    try {
      await createEntity({ entityType: type.key, name: name.trim(), data });
      await queryClient.invalidateQueries({ queryKey: ['entities', type.key] });
      notify.success('Record added.');
      setName('');
      setValues({ ...defaults });
      onSuccess?.();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not add the record.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">New {type.label.toLowerCase()}</h2>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <div className="space-y-1.5">
          <Label htmlFor="record-name">
            Name<span className="ml-1 text-error-600">*</span>
          </Label>
          <Input
            id="record-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setNameMissing(false);
            }}
            placeholder={`New ${type.label.toLowerCase()}`}
            aria-invalid={nameMissing || undefined}
            aria-describedby={nameMissing ? 'record-name-error' : undefined}
          />
          {nameMissing ? (
            <p id="record-name-error" className="text-xs text-error-600">
              Name is required.
            </p>
          ) : null}
        </div>

        {shown.map((attr) =>
          hasAssigneePair && attr.name === ASSIGNEE_SUB_ATTR ? (
            <div key={attr.id} className="space-y-1.5">
              <Label>Assignee</Label>
              <AssigneePicker
                value={String(values[ASSIGNEE_SUB_ATTR] ?? '')}
                onChange={(sub, assigneeName) =>
                  setValues((prev) => ({ ...prev, [ASSIGNEE_SUB_ATTR]: sub, [ASSIGNEE_NAME_ATTR]: assigneeName }))
                }
              />
            </div>
          ) : (
            <AttributeField
              key={attr.id}
              attr={attr}
              value={values[attr.name]}
              onChange={(v) => setValue(attr.name, v)}
            />
          ),
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={saving}>
          {saving ? 'Adding…' : `Add ${type.label.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
