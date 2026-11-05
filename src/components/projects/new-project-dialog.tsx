'use client';

/**
 * New project (wireframe V08, bd startsim-gabli): a name, and "Is it for a client?
 * Optional" with "No, it's my own", each client, and "New client…". On create it
 * goes to the project page.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { BaseDialog, Button, Input, Label, notify } from '@startsimpli/ui';

import { createProject, type ClientOption } from '@/lib/projects-api';

const NO_CLIENT = '';
const NEW_CLIENT = '__new__';

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
  const [newClientName, setNewClientName] = useState('');
  const [nameMissing, setNameMissing] = useState(false);
  const [clientMissing, setClientMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameMissing(true);
      return;
    }
    const makingClient = clientPath === NEW_CLIENT;
    if (makingClient && !newClientName.trim()) {
      setClientMissing(true);
      return;
    }
    setSaving(true);
    try {
      const created = await createProject({
        name,
        clientPath: makingClient ? null : clientPath || null,
        newClientName: makingClient ? newClientName : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setName('');
      setClientPath(NO_CLIENT);
      setNewClientName('');
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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">New project</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

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
            onChange={(e) => {
              setClientPath(e.target.value);
              setClientMissing(false);
            }}
            className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            <option value={NO_CLIENT}>No, it&apos;s my own</option>
            {clients.map((c) => (
              <option key={c.path} value={c.path}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CLIENT}>New client…</option>
          </select>
          {clientPath === NEW_CLIENT ? (
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="project-new-client">Client name</Label>
              <Input
                id="project-new-client"
                value={newClientName}
                onChange={(e) => {
                  setNewClientName(e.target.value);
                  if (e.target.value.trim()) setClientMissing(false);
                }}
                aria-invalid={clientMissing || undefined}
              />
              {clientMissing ? <p className="text-xs text-error-600">Client name is required.</p> : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-1 text-sm text-gray-500">
          <p>A client is optional. You can set it later.</p>
          <p>A new project starts empty. Add sources next.</p>
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
