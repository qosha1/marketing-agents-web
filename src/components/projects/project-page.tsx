'use client';

/**
 * Project page (wireframe V08 "Project", bd startsim-85tss): the head (back link,
 * name, client, Current, path and created date, Change client), one Brief card and
 * one Sources card. Nothing else.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiException } from '@startsimpli/api';
import { Button, notify } from '@startsimpli/ui';

import { ChangeClientDialog } from '@/components/projects/change-client-dialog';
import { countProjectSources, listClients, loadProject, saveBrief } from '@/lib/projects-api';
import { useActiveProjectId } from '@/lib/use-active-project';

/** Research settings, opened on this project. Lane 2 owns the page; the project travels as `?project=<scope path>`. */
export function researchSettingsHref(path: string): string {
  return `/research/settings?project=${encodeURIComponent(path)}`;
}

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ProjectPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const activePath = useActiveProjectId();
  const clientsQuery = useQuery({ queryKey: ['projects', 'clients'], queryFn: listClients });
  const clients = clientsQuery.data ?? [];
  const project = useQuery({
    queryKey: ['projects', 'one', id, clients],
    queryFn: () => loadProject(id, clients),
    enabled: clientsQuery.isSuccess || clientsQuery.isError,
    // An id that names nothing is an answer, not a blip: say so at once instead of retrying.
    retry: (count, err) => !(err instanceof ApiException && err.status === 404) && count < 2,
  });
  const sources = useQuery({
    queryKey: ['projects', 'sources', project.data?.row.path],
    queryFn: () => countProjectSources(project.data!.row.path),
    enabled: !!project.data?.row.path,
  });
  // null = untouched: the textarea shows what was saved until the first keystroke.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);

  if (project.isLoading || clientsQuery.isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (project.error instanceof ApiException && project.error.status === 404) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-neutral-700">This project does not exist.</p>
        <Link href="/projects" className="text-sm font-medium text-indigo-700 hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }
  if (project.isError || !project.data) return <p className="text-sm text-error-600">Could not load this project.</p>;
  const { record, row } = project.data;
  const created = day(row.createdAt);
  const brief = draft ?? row.brief;

  async function save() {
    setSaving(true);
    try {
      await saveBrief(record, brief);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDraft(null);
      notify.success('Brief saved.');
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save the brief.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link href="/projects" className="text-sm text-neutral-500 hover:underline">
            ‹ Projects
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-neutral-900">{row.name}</h1>
            {row.path === activePath ? (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">Current</span>
            ) : null}
          </div>
          {row.client ? <p className="text-sm text-neutral-700">{row.client}</p> : null}
          <p className="text-sm text-neutral-500">
            {row.path}
            {created ? ` · created ${created}` : ''}
          </p>
        </div>
        <Button variant="outline" onClick={() => setChanging(true)}>
          Change client
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <label htmlFor="project-brief" className="block text-sm font-semibold text-gray-900">
          Brief
        </label>
        <p className="text-sm text-gray-500">What this project writes about, for whom, and in what voice. The writer reads this.</p>
        <textarea
          id="project-brief"
          value={brief}
          onChange={(e) => setDraft(e.target.value)}
          className="block h-[140px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        />
        {brief !== row.brief ? (
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save brief'}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-3.5">
        <span className="text-sm">
          <b className="font-semibold text-gray-900">Sources</b>{' '}
          <span className="text-gray-500">{sources.data == null ? '' : `${sources.data} configured`}</span>
        </span>
        <Link href={researchSettingsHref(row.path)} className="text-sm font-medium text-indigo-700 hover:underline">
          Manage sources
        </Link>
      </div>

      {changing ? (
        <ChangeClientDialog
          open
          onOpenChange={setChanging}
          record={record}
          currentClientPath={row.clientPath}
          clients={clients.filter((c) => c.active || c.path === row.clientPath)}
        />
      ) : null}
    </div>
  );
}
