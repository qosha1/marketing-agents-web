'use client';

/** Change client (wireframe V08, Project page): pick another client, or none. The project keeps its path. */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BaseDialog, Button, Label, notify } from '@startsimpli/ui';

import { changeProjectClient, type ClientOption } from '@/lib/projects-api';
import type { EntityRecord } from '@/lib/foundry-api';

export function ChangeClientDialog({
  open,
  onOpenChange,
  record,
  currentClientPath,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: EntityRecord;
  currentClientPath: string | null;
  clients: ClientOption[];
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(currentClientPath ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await changeProjectClient(record, value || null);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      onOpenChange(false);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not change the client.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BaseDialog open={open} onOpenChange={onOpenChange}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Change client</h2>
        <div className="space-y-1.5">
          <Label htmlFor="change-client">Client</Label>
          <select
            id="change-client"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">No, it&apos;s my own</option>
            {clients.map((c) => (
              <option key={c.path} value={c.path}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || value === (currentClientPath ?? '')}>
            {saving ? 'Saving…' : 'Change client'}
          </Button>
        </div>
      </form>
    </BaseDialog>
  );
}
