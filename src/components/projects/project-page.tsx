'use client';

/**
 * Project page (bd startsim-85tss): one Brief and a Sources card. Nothing else.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Label, notify } from '@startsimpli/ui';

import { countProjectSources, loadProject, saveBrief } from '@/lib/projects-api';

/** Research settings, opened on this project. Lane 2 owns the page; the project travels as `?project=<scope path>`. */
export function researchSettingsHref(path: string): string {
  return `/research/settings?project=${encodeURIComponent(path)}`;
}

export function ProjectPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const project = useQuery({ queryKey: ['projects', 'one', id], queryFn: () => loadProject(id) });
  const sources = useQuery({
    queryKey: ['projects', 'sources', project.data?.row.path],
    queryFn: () => countProjectSources(project.data!.row.path),
    enabled: !!project.data?.row.path,
  });
  const [brief, setBrief] = useState('');
  const [saving, setSaving] = useState(false);

  const loadedBrief = project.data?.row.brief;
  useEffect(() => {
    if (loadedBrief !== undefined) setBrief(loadedBrief);
  }, [loadedBrief]);

  if (project.isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (project.isError || !project.data) return <p className="text-sm text-error-600">Could not load this project.</p>;
  const { record, row } = project.data;

  async function save() {
    setSaving(true);
    try {
      await saveBrief(record, brief);
      await queryClient.invalidateQueries({ queryKey: ['projects', 'one', id] });
      notify.success('Brief saved.');
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save the brief.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-gray-500 hover:underline">
          Projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">{row.name}</h1>
        {row.client ? <p className="text-sm text-gray-500">{row.client}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="project-brief">Brief</Label>
        <textarea
          id="project-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={8}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        />
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || brief === row.brief}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Sources</h2>
          <p className="text-sm text-gray-600">
            {sources.data == null
              ? 'Sources are shared across projects for now.'
              : `${sources.data} ${sources.data === 1 ? 'source' : 'sources'}`}
          </p>
        </div>
        <Link
          href={researchSettingsHref(row.path)}
          className="text-sm font-medium text-primary-700 hover:underline"
        >
          Manage sources
        </Link>
      </div>
    </div>
  );
}
