'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Label,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  notify,
} from '@startsimpli/ui';
import { AttributeField } from './attribute-field';
import { createEntity, type EntityTypeDef } from '@/lib/foundry-api';

interface RecordFormProps {
  type: EntityTypeDef;
}

/**
 * Metadata-driven create form: renders one AttributeField per declared
 * attribute, plus the always-present record Name. Coerces the JSON field and
 * posts to /entities/.
 */
export function RecordForm({ type }: RecordFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  function setValue(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      notify.error('Give this record a name.');
      return;
    }

    // Build the data blob, coercing json fields from text and dropping blanks.
    const data: Record<string, unknown> = {};
    for (const attr of type.attributes) {
      const raw = values[attr.name];
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

    setSaving(true);
    try {
      await createEntity({ entityType: type.key, name: name.trim(), data });
      await queryClient.invalidateQueries({ queryKey: ['entities', type.key] });
      notify.success('Record added.');
      setName('');
      setValues({});
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not add the record.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a {type.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="record-name">
              Name<span className="ml-1 text-error-600">*</span>
            </Label>
            <Input
              id="record-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`New ${type.label.toLowerCase()}`}
            />
          </div>

          {type.attributes.map((attr) => (
            <AttributeField
              key={attr.id}
              attr={attr}
              value={values[attr.name]}
              onChange={(v) => setValue(attr.name, v)}
            />
          ))}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? 'Adding…' : 'Add record'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
