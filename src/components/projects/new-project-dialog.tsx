'use client';

/**
 * New project (bd startsim-gabli): a name, and "Is it for a client? Optional"
 * with "No, it's my own". On create it goes to the project page.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { BaseDialog, Button, Input, Label, notify } from '@startsimpli/ui';

import { createProject, type ClientOption } from '@/lib/projects-api';

const NO_CLIENT = '';

export function NewProjectDialog({
  open,
  onOpenChange,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ClientOption[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [clientPath, setClientPath] = useState(NO_CLIENT);
  const [nameMissing, setNameMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameMissing(true);
      return;
    }
    setSaving(true);
    try {
      const created = await createProject({ name, clientPath: clientPath || null });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setName('');
      setClientPath(NO_CLIENT);
      onOpenChange(false);
      router.push(`/projects/${created.id}`);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not create the project.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BaseDialog open={open} onOpenChange={onOpenChange}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">New project</h2>

        <div className="space-y-1.5">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setNameMissing(false);
            }}
            aria-invalid={nameMissing || undefined}
            aria-describedby={nameMissing ? 'project-name-error' : undefined}
          />
          {nameMissing ? (
            <p id="project-name-error" className="text-xs text-error-600">
              Name is required.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="project-client">
            Is it for a client? <span className="font-normal text-gray-500">Optional</span>
          </Label>
          <select
            id="project-client"
            value={clientPath}
            onChange={(e) => setClientPath(e.target.value)}
            className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value={NO_CLIENT}>No, it&apos;s my own</option>
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
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </form>
    </BaseDialog>
  );
}
