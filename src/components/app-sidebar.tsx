'use client';

/**
 * App shell nav for a Foundry-templated tenant app. The sidebar is data-driven:
 * one section per entity type the tenant declared (status types open as a board,
 * others as a table). No schema/admin tools here — those live in the Foundry
 * console. Brand comes from foundry.config (substituted at fork time). Edit this
 * however you like — it's your app.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Home, LayoutGrid, Table, LogOut } from 'lucide-react';
import { useAuth } from '@startsimpli/auth';

import { signinUrl } from '@/lib/api';
import { listTypes } from '@/lib/foundry-api';
import { isBoardType, typeRoute } from '@/lib/board';
import { FOUNDRY } from '@/foundry.config';

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const typesQuery = useQuery({ queryKey: ['schema-types'], queryFn: () => listTypes() });
  const types = typesQuery.data?.results ?? [];

  const homeActive = pathname === '/';
  const brand = FOUNDRY.name && !FOUNDRY.name.startsWith('__') ? FOUNDRY.name : FOUNDRY.slug;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-600 text-xs font-bold text-white">
          {brand.slice(0, 2).toUpperCase()}
        </div>
        <span className="truncate font-semibold text-gray-900">{brand}</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <NavLink href="/" label="Home" icon={Home} active={homeActive} />

        {types.length > 0 && (
          <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Sections
          </p>
        )}
        {types.map((t) => {
          const href = typeRoute(t);
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <NavLink
              key={t.id}
              href={href}
              label={t.label}
              icon={isBoardType(t) ? LayoutGrid : Table}
              active={active}
            />
          );
        })}
      </nav>

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

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
