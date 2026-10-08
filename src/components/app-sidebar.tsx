'use client';

/**
 * App shell nav for a Foundry-templated tenant app. The sidebar is data-driven:
 * the nav item tree comes from `buildNav` (see src/foundry.nav.ts) over the entity
 * types the tenant declared, rendered through the shared @startsimpli/ui
 * <GroupedNav/>. No schema/admin tools here — those live in the Foundry console.
 * Brand comes from foundry.config (substituted at fork time). Edit this however
 * you like — it's your app.
 *
 * Two homes for the same nav (bd startsim-g2m75). From `md` up it is the fixed
 * rail beside the content. Below `md` a 240px rail left ~52px of content at
 * 390px, so the rail is hidden and a menu button in a top bar opens the same
 * nav as a modal drawer (shared <NavDrawer/>: focus trap, Escape, outside tap).
 * Which one shows is pure CSS, so the first paint is right with no viewport
 * read. The drawer's open state is client state — never a search param, since
 * this renders inside a layout and layouts don't re-render on soft navigation.
 */
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useAuth } from '@startsimpli/auth';
import { GroupedNav, NavDrawer, NavDrawerButton } from '@startsimpli/ui';

import { signinUrl } from '@/lib/api';
import { listTypes } from '@/lib/foundry-api';
import { buildNav } from '@/foundry.nav';
import { navIsActive } from '@/lib/nav-active';
import { FOUNDRY } from '@/foundry.config';


function useBrand() {
  return FOUNDRY.name && !FOUNDRY.name.startsWith('__') ? FOUNDRY.name : FOUNDRY.slug;
}

function BrandMark({ brand }: { brand: string }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-600 text-xs font-bold text-white">
      {brand.slice(0, 2).toUpperCase()}
    </div>
  );
}

/**
 * Brand, nav and account footer — shared by the rail and the drawer.
 * `onNavigate` runs on every link click: the drawer closes from here rather
 * than from a pathname effect, which would miss a tap on the current page.
 */
function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { user, logout } = useAuth();
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const types = typesQuery.data?.results ?? [];

  const activeHref = pathname + (search ? `?${search}` : '');
  const brand = useBrand();

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-5">
        <BrandMark brand={brand} />
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
              onClick={onNavigate}
            >
              {content}
            </Link>
          )}
        />
      </div>

      <div className="shrink-0 border-t border-gray-200 p-3">
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
    </>
  );
}

export function AppSidebar() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const brand = useBrand();

  return (
    <>
      {/* sticky + h-screen are load-bearing: as a plain flex child of the layout's
          min-h-screen row the aside STRETCHES to the full document height, so the
          account footer below lands at the bottom of the *page* (below the fold on
          any long table) and `flex-1 overflow-y-auto` on the nav never engages.
          Bounding the height to the viewport pins the footer bottom-left and lets a
          long nav scroll inside itself. self-start keeps stretch from fighting it.
          hidden below md: see the header comment. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col self-start border-r border-gray-200 bg-white md:flex">
        <SidebarBody />
      </aside>

      {/* Phone/narrow top bar. Not sticky on purpose: the draft page pins its own
          Content | Quality switch to top-0 and the two would stack over the text. */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 md:hidden">
        <NavDrawerButton open={drawerOpen} onOpenChange={setDrawerOpen} />
        <BrandMark brand={brand} />
        <span className="min-w-0 truncate font-semibold text-gray-900">{brand}</span>
      </header>

      <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Navigation">
        <SidebarBody onNavigate={() => setDrawerOpen(false)} />
      </NavDrawer>
    </>
  );
}
