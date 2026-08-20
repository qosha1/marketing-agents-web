'use client';

/**
 * App shell nav for a Foundry-templated tenant app. The sidebar is data-driven:
 * the nav item tree comes from `buildNav` (see src/foundry.nav.ts) over the entity
 * types the tenant declared, rendered through the shared @startsimpli/ui
 * <GroupedNav/>. No schema/admin tools here — those live in the Foundry console.
 * Brand comes from foundry.config (substituted at fork time). Edit this however
 * you like — it's your app.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useAuth } from '@startsimpli/auth';
import { GroupedNav } from '@startsimpli/ui';

import { signinUrl } from '@/lib/api';
import { listTypes } from '@/lib/foundry-api';
import { buildNav } from '@/foundry.nav';
import { navIsActive } from '@/lib/nav-active';
import { FOUNDRY } from '@/foundry.config';


export function AppSidebar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { user, logout } = useAuth();
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const types = typesQuery.data?.results ?? [];

  const activeHref = pathname + (search ? `?${search}` : '');
  const brand = FOUNDRY.name && !FOUNDRY.name.startsWith('__') ? FOUNDRY.name : FOUNDRY.slug;

  return (
    // sticky + h-screen are load-bearing: as a plain flex child of the layout's
    // min-h-screen row the aside STRETCHES to the full document height, so the
    // account footer below lands at the bottom of the *page* (below the fold on
    // any long table) and `flex-1 overflow-y-auto` on the nav never engages.
    // Bounding the height to the viewport pins the footer bottom-left and lets a
    // long nav scroll inside itself. self-start keeps stretch from fighting it.
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col self-start border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-600 text-xs font-bold text-white">
          {brand.slice(0, 2).toUpperCase()}
        </div>
        <span className="truncate font-semibold text-gray-900">{brand}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <GroupedNav
          items={buildNav(types)}
          activeHref={activeHref}
          isActive={navIsActive}
          renderLink={({ link, active, className, content }) => (
            <Link
              href={link.href}
              className={className}
              aria-current={active ? 'page' : undefined}
            >
              {content}
            </Link>
          )}
        />
      </div>

      <div className="border-t border-gray-200 p-3">
        <div className="mb-2 px-2">
          <p className="truncate text-sm font-medium text-gray-900">{user?.email ?? '—'}</p>
          <p className="text-xs text-gray-500">Signed in</p>
        </div>
        <button
          onClick={async () => {
            try {
              await logout();
            } finally {
              if (typeof window !== 'undefined') {
                window.location.href = signinUrl(`${window.location.origin}/`);
              }
            }
          }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}
