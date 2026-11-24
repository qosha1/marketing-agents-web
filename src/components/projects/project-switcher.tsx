'use client';

/**
 * Sidebar project switcher (wireframe C01, bd startsim-4ma5a). One button naming
 * the active project (with its client above it when it has one) that opens a menu:
 * projects of your own first, then each client with its projects, then All
 * projects and Manage projects. Picking one scopes Content and Research; the
 * choice is a scope path, so a client's project narrows to that project only.
 *
 * Nothing is created here: a tenant with no projects starts on the Projects page
 * (wireframe V08 "First run"), so the button reads "No client yet" until one exists.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FolderKanban, LayoutGrid } from 'lucide-react';

import { listAllEntities } from '@/lib/foundry-api';
import { PROJECT_TYPE } from '@/lib/projects';
import { describeActive, setActiveProjectId, switcherModel, type ProjectChoice } from '@/lib/project-scope';
import { useActiveProjectId } from '@/lib/use-active-project';

function Avatar({ text, small }: { text: string; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center bg-indigo-50 font-bold text-indigo-700 ${
        small ? 'h-5 w-5 rounded text-[10px]' : 'h-7 w-7 rounded-md text-xs'
      }`}
    >
      {text.charAt(0).toUpperCase() || '+'}
    </span>
  );
}

const itemClass =
  'flex h-[34px] w-full items-center gap-2 rounded px-2.5 text-left text-sm text-slate-950 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none';
const headClass = 'px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.6px] text-slate-500';

export function ProjectSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const queryClient = useQueryClient();
  const active = useActiveProjectId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const scopes = useQuery({
    queryKey: ['projects', 'switcher'],
    queryFn: () => listAllEntities(PROJECT_TYPE),
    staleTime: 60_000,
  });

  const records = scopes.data ?? [];
  const model = switcherModel(records);
  const current = describeActive(records, model, active);

  // A stored path that names nothing (deleted project, older build) would leave every
  // list empty with no explanation, so it is dropped once the scopes have loaded.
  useEffect(() => {
    if (scopes.isSuccess && active && !current) setActiveProjectId(null);
  }, [scopes.isSuccess, active, current]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(path: string | null) {
    setOpen(false);
    if (path === active) return;
    setActiveProjectId(path);
    // Every list re-asks with the new scope.
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] !== 'projects' && q.queryKey[0] !== 'schema-types',
    });
  }

  const none = scopes.isSuccess && model.projects.length === 0;
  const name = none ? 'No client yet' : (current?.label ?? 'All projects');
  const caption = none ? 'Client' : (current?.caption ?? 'Project');

  const choice = (p: ProjectChoice, indent: boolean) => (
    <button
      key={p.path}
      type="button"
      role="menuitem"
      onClick={() => pick(p.path)}
      className={`${itemClass} ${p.path === active ? 'bg-slate-100' : ''} ${indent ? 'pl-7' : ''}`}
    >
      {indent ? null : <Avatar text={p.label} small />}
      <span className="min-w-0 flex-1 truncate">{p.label}</span>
      {p.path === active ? <Check className="h-3.5 w-3.5 text-indigo-600" aria-hidden /> : null}
    </button>
  );

  return (
    <div ref={root} className="relative px-3 pt-3">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-12 w-full items-center gap-2.5 rounded-lg border bg-white px-2.5 text-left ${
          open ? 'border-indigo-300 ring-2 ring-indigo-500/15' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <Avatar text={none ? '+' : name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <small className="text-[11px] leading-[14px] text-slate-500">{caption}</small>
          <b className="truncate text-sm font-semibold leading-[18px]">{name}</b>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute left-3 right-3 top-[66px] z-30 flex max-h-[70vh] flex-col overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
        >
          {model.projects.length > 0 ? <div className={headClass}>Switch project</div> : null}
          {model.solo.map((p) => choice(p, false))}
          {model.clients.map((c) => (
            <div key={c.path} className="flex flex-col">
              <div className={headClass}>{c.name}</div>
              {c.projects.map((p) => choice(p, true))}
            </div>
          ))}
          {model.projects.length > 0 ? <div className="my-1 h-px bg-slate-200" /> : null}
          <button type="button" role="menuitem" onClick={() => pick(null)} className={`${itemClass} ${active ? '' : 'bg-slate-100'}`}>
            <LayoutGrid className="h-4 w-4 text-slate-600" aria-hidden />
            <span className="flex-1">All projects</span>
            {active ? null : <Check className="h-3.5 w-3.5 text-indigo-600" aria-hidden />}
          </button>
          <div className="my-1 h-px bg-slate-200" />
          <Link
            href="/projects"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className={itemClass}
          >
            <FolderKanban className="h-4 w-4 text-slate-600" aria-hidden />
            Manage projects
          </Link>
        </div>
      ) : null}
    </div>
  );
}
