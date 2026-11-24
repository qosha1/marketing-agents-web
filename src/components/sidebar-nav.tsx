'use client';

/**
 * The rail's links (wireframe C01). A flat list: Dashboard, Content, Projects,
 * and Research, which opens to Overview / Topics / Sources / Settings. The
 * current page is a solid indigo row; a Research parent whose child is current
 * is tinted instead, so exactly one row is solid.
 */
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { isNavParent, type NavEntry, type NavLeaf } from '@/foundry.nav';
import { navIsActive } from '@/lib/nav-active';

const icons = '[&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0';
const row = `flex h-9 items-center gap-3 rounded-md px-3 text-[14.5px] transition-colors ${icons}`;
const parentRow = `flex h-9 items-center rounded-md pr-2 text-[14.5px] transition-colors ${icons}`;
const idle = 'text-slate-800 hover:bg-slate-50 [&_svg]:text-slate-600';
const solid = 'bg-indigo-500 text-white [&_svg]:text-white';
const parentOn = 'font-semibold text-indigo-700 [&_svg]:text-indigo-600';

function leafActive(leaf: NavLeaf, activeHref: string): boolean {
  const path = activeHref.split('?')[0];
  return navIsActive(leaf.href, activeHref) || (leaf.alsoActiveOn ?? []).some((p) => path === p || path.startsWith(`${p}/`));
}

export function SidebarNav({
  entries,
  activeHref,
  onNavigate,
}: {
  entries: NavEntry[];
  activeHref: string;
  onNavigate?: () => void;
}) {
  const [closed, setClosed] = useState(false);
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {entries.map((entry) => {
        if (!isNavParent(entry)) {
          const active = leafActive(entry, activeHref);
          return (
            <Link
              key={entry.href}
              href={entry.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`${row} ${active ? solid : idle}`}
            >
              {entry.icon}
              <span>{entry.label}</span>
            </Link>
          );
        }
        const childActive = entry.items.some((c) => leafActive(c, activeHref));
        // Open whenever you are inside it; the chevron collapses it when you are not looking at it.
        const open = childActive || !closed;
        return (
          <div key={entry.label} className="flex flex-col">
            <div className={`${parentRow} ${childActive ? parentOn : idle}`}>
              <Link href={entry.href} onClick={onNavigate} className="flex h-9 flex-1 items-center gap-3 px-3">
                {entry.icon}
                <span>{entry.label}</span>
              </Link>
              <button
                type="button"
                aria-label={`${open ? 'Collapse' : 'Expand'} ${entry.label}`}
                aria-expanded={open}
                disabled={childActive}
                onClick={() => setClosed(open)}
                className="mr-2 flex h-6 w-6 items-center justify-center rounded text-inherit disabled:cursor-default"
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
              </button>
            </div>
            {open ? (
              <div className="-mt-0.5 flex flex-col gap-0.5">
                {entry.items.map((child) => {
                  const active = leafActive(child, activeHref);
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`relative flex h-8 items-center gap-2.5 rounded-md pl-[42px] pr-3 text-sm ${active ? solid : idle}`}
                    >
                      <span
                        aria-hidden
                        className={`absolute left-[21px] top-1/2 -mt-[2px] h-[5px] w-[5px] rounded-full ${active ? 'bg-white' : 'bg-slate-400'}`}
                      />
                      <span>{child.label}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
