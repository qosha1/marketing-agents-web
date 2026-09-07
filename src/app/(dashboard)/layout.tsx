'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@startsimpli/auth';
import { signinUrl } from '@/lib/api';
import { AppSidebar } from '@/components/app-sidebar';

// Two marks, because "we set off" and "we came back empty" are different facts
// and only the second one licenses an accusation (bd startsim-y4rfq).
//
// The loop this guard exists to stop: an account authenticated centrally but NOT
// authorized for THIS foundry gets a token whose audience != this tenant, so
// whoami 401s. Bouncing again would trap it in an infinite redirect. So we mark
// the tab before leaving and refuse to leave twice.
//
// But that mark is written BEFORE the redirect, so on its own it only says we
// STARTED to go. Reading it as "central sent us back and we still have nothing"
// is what made every unrelated session failure — a dropped connection, a back
// button out of central, a restored tab, a backend that didn't answer — render
// "your account isn't a member of this foundry": a specific, confident claim
// that was usually false, and that sends the reader off to ask someone to fix a
// membership that was never the problem.
//
// So BOUNCE_KEY now holds a per-trip nonce that also rides out in the return_to
// and comes back on the URL as RETURN_PARAM. The mark alone still stops the
// loop; the mark AND its matching marker is the proof — and only that proof
// gets the denial. Everything else gets a retry, because a retry may well work.
const BOUNCE_KEY = 'ss_tenant_auth_bounced';
const RETURN_PARAM = 'ss_tenant_auth_return';

/**
 * What we know about a dashboard load that has no tenant session.
 *
 * - `pending`: nothing decided. Also the state during the redirect we just
 *   started, which is why the verdict is never derived during render.
 * - `denied`: we sent them to central, central sent them back, and this tenant
 *   still will not have them. For this reader the accusation is the truth.
 * - `unresolved`: we set off and did not come back through our own marker. We
 *   do not know why, and we must not guess.
 */
type Outcome = 'pending' | 'denied' | 'unresolved';

function newTripId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const [outcome, setOutcome] = useState<Outcome>('pending');

  useEffect(() => {
    if (isLoading) return;
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const marker = url.searchParams.get(RETURN_PARAM);
    // The marker is single-use plumbing: spend it as soon as it has been read so
    // it never lingers in the address bar, in a bookmark, or in a copied link.
    const spendMarker = () => {
      if (marker === null) return;
      url.searchParams.delete(RETURN_PARAM);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    };

    if (user) {
      sessionStorage.removeItem(BOUNCE_KEY);
      spendMarker();
      return;
    }

    // No tenant session.
    const trip = sessionStorage.getItem(BOUNCE_KEY);

    if (!trip) {
      // First time in this tab. Go and ask, carrying an id we can recognise on
      // the way back — a marker on a URL we never issued proves nothing.
      const id = newTripId();
      sessionStorage.setItem(BOUNCE_KEY, id);
      url.searchParams.set(RETURN_PARAM, id);
      window.location.href = signinUrl(url.toString());
      return;
    }

    // We already set off, so we do not set off again either way. The only
    // question left is whether we can prove we came back.
    const cameBack = marker !== null && marker === trip;
    spendMarker();

    // Deliberately left as state set from the effect (bd startsim-mcoza). Both
    // ways of deriving it are WORSE, and both were measured, not guessed:
    // reading the marks during render repaints an in-flight redirect as a
    // verdict (red in layout.test.tsx), and caching that read so it can't
    // reopens the double-bounce loop — during hydration `useSyncExternalStore`
    // serves `getServerSnapshot()`, so the effect would see "not bounced yet" on
    // a load where it HAD bounced and go round again. Still true now that the
    // verdict is three-way; the tests beside it pin both windows.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deriving it flashes a verdict over an in-flight redirect; caching the read reopens the double-bounce loop across hydration.
    setOutcome(cameBack ? 'denied' : 'unresolved');
  }, [user, isLoading]);

  if (outcome === 'denied') {
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

  if (outcome === 'unresolved') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center">
        <h1 className="text-xl font-semibold text-gray-900">We couldn’t finish signing you in</h1>
        <p className="max-w-md text-sm text-gray-600">
          The trip to the sign-in page didn’t come back with an answer, so this app still doesn’t
          know who you are. That’s usually temporary — a dropped connection, an interrupted
          redirect, or a backend that didn’t respond — and it says nothing about your account or
          your membership.
        </p>
        <button
          onClick={() => {
            sessionStorage.removeItem(BOUNCE_KEY);
            window.location.reload();
          }}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Try again
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
