'use client';

import {
  Input,
  Textarea,
  Checkbox,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@startsimpli/ui';
import type { AttributeDef } from '@/lib/foundry-api';

interface AttributeFieldProps {
  attr: AttributeDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * Metadata-driven input: renders the right control for an attribute's data_type.
 * Used by the dynamic record-create form. Returned values match what the
 * backend expects inside the entity `data` blob.
 */
export function AttributeField({ attr, value, onChange }: AttributeFieldProps) {
  const id = `field-${attr.name}`;
  const label = (
    <Label htmlFor={id}>
      {attr.name}
      {attr.required && <span className="ml-1 text-error-600">*</span>}
    </Label>
  );

  if (attr.dataType === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(c) => onChange(c === true)}
        />
        {label}
      </div>
    );
  }

  if (attr.dataType === 'enum') {
    const choices = Array.isArray(attr.config?.choices)
      ? (attr.config.choices as unknown[]).map(String)
      : [];
    return (
      <div className="space-y-1.5">
        {label}
        <Select
          value={value != null ? String(value) : undefined}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select…" />
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
    );
  }

  if (attr.dataType === 'longtext' || attr.dataType === 'json') {
    return (
      <div className="space-y-1.5">
        {label}
        <Textarea
          id={id}
          value={value != null ? String(value) : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={attr.dataType === 'json' ? 5 : 3}
          placeholder={attr.dataType === 'json' ? '{ }' : undefined}
          className={attr.dataType === 'json' ? 'font-mono text-xs' : undefined}
        />
      </div>
    );
  }

  // text, number, integer, date
  const inputType =
    attr.dataType === 'number' || attr.dataType === 'integer'
      ? 'number'
      : attr.dataType === 'date'
        ? 'date'
        : 'text';

  return (
    <div className="space-y-1.5">
      {label}
      <Input
        id={id}
        type={inputType}
        step={attr.dataType === 'number' ? 'any' : undefined}
        value={value != null ? String(value) : ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (attr.dataType === 'integer') {
            onChange(raw === '' ? '' : parseInt(raw, 10));
          } else if (attr.dataType === 'number') {
            onChange(raw === '' ? '' : parseFloat(raw));
          } else {
            onChange(raw);
          }
        }}
      />
    </div>
  );
}
