'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@startsimpli/auth';
import { signinUrl } from '@/lib/api';
import { AppSidebar } from '@/components/app-sidebar';

// Marks that we've already bounced to central once for this tab. If we come
// back STILL without a tenant session, the account is authenticated centrally
// but NOT authorized for THIS foundry (its token's audience != this tenant, so
// whoami 401s) — bouncing again would trap the user in an infinite loop. We
// stop and show a denial instead. Cleared the moment a valid session resolves.
const BOUNCE_KEY = 'ss_tenant_auth_bounced';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (typeof window === 'undefined') return;
    if (user) {
      sessionStorage.removeItem(BOUNCE_KEY);
      return;
    }
    // No tenant session.
    if (sessionStorage.getItem(BOUNCE_KEY)) {
      // We already bounced to central and returned without a session — this
      // account isn't a member of this foundry. Stop the loop; show denial.
      setDenied(true);
      return;
    }
    sessionStorage.setItem(BOUNCE_KEY, '1');
    window.location.href = signinUrl(window.location.href);
  }, [user, isLoading]);

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center">
        <h1 className="text-xl font-semibold text-gray-900">You don’t have access to this platform</h1>
        <p className="max-w-md text-sm text-gray-600">
          You’re signed in, but your account isn’t a member of this foundry. Sign in with an account
          that belongs to it, or ask the platform owner to add you.
        </p>
        <button
          onClick={() => {
            sessionStorage.removeItem(BOUNCE_KEY);
            void logout().finally(() => {
              window.location.href = signinUrl(`${window.location.origin}/`);
            });
          }}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Sign in with a different account
        </button>
      </div>
    );
  }

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AppSidebar />
      {/* min-w-0 is load-bearing: main is a flex child, so without it its
          min-width is content-based and a wide board (kanban) grows main past the
          viewport — then overflow-x-hidden CLIPS it instead of letting the board's
          own overflow-x-auto scroll. With min-w-0, main is bounded by the flex
          track and wide content scrolls inside it. No max-w cap so the board uses
          the full width up to the screen edge (left-aligned, not mx-auto). */}
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="w-full px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
