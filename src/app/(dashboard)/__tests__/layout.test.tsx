/**
 * The tenant-auth bounce guard (bd startsim-mcoza, bd startsim-y4rfq).
 *
 * This layout decides, for every dashboard page, between four outcomes: send
 * the visitor to central to sign in, tell them they are not a member of THIS
 * foundry, tell them the sign-in trip did not come back, or render the app.
 * Getting it wrong either locks a legitimate reviewer out or traps them in a
 * redirect loop, and neither shows up in a type-check.
 *
 * WHAT THE MARK MEANS, and why there are now two of them. The sessionStorage
 * mark is written BEFORE the redirect, so on its own it only says "we set off";
 * it cannot say "we came back empty". Treating it as the latter is what made
 * every session failure — a dropped connection, a back button out of central, a
 * restored tab — render "your account isn't a member of this foundry", an
 * accusation that is specific, confident and usually false (startsim-y4rfq).
 * So the departure mark is now a nonce that also rides out in the return_to and
 * comes back on the URL. Mark AND matching marker is proof of a completed round
 * trip, and only that proof licenses the denial. The mark alone still stops the
 * loop — it just no longer accuses anyone.
 *
 * The lint error on `setOutcome` is suppressed rather than fixed because the
 * derived version — read the mark during render via `useSyncExternalStore` —
 * went RED here: after the bounce sets the mark, the next render paints the
 * verdict over a redirect that is still in flight. Caching the read to stop
 * that reopens the double-bounce loop across hydration, where
 * `getServerSnapshot` reports "not bounced" on a load that had. Both are still
 * true of the three-way state; the redirect-in-flight window is covered below.
 */
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BOUNCE_KEY = 'ss_tenant_auth_bounced';
const RETURN_PARAM = 'ss_tenant_auth_return';

type AuthState = { user: unknown; isLoading: boolean };
const auth: AuthState = { user: null, isLoading: false };
const logout = vi.fn(() => Promise.resolve());

vi.mock('@startsimpli/auth', () => ({
  useAuth: () => ({ user: auth.user, isLoading: auth.isLoading, logout }),
}));

vi.mock('@/lib/api', () => ({
  signinUrl: (returnTo?: string) => `https://auth.example.test/signin?next=${encodeURIComponent(returnTo ?? '')}`,
}));

// The sidebar fans out into next/navigation, react-query and the schema API.
// None of that is the guard under test.
vi.mock('@/components/app-sidebar', () => ({
  AppSidebar: () => <nav data-testid="sidebar" />,
}));

import DashboardLayout from '../layout';

/**
 * jsdom refuses real navigation, so stand in for `window.location`. The guard
 * reads the query string to find the return marker, so the stand-in has to
 * carry the parsed pieces too, not just `href`.
 */
function stubLocation(href: string) {
  const u = new URL(href);
  const loc = {
    href,
    origin: u.origin,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    reload: vi.fn(),
  };
  vi.stubGlobal('location', loc);
  return loc;
}

/** Inert stand-in: we assert on the call, we don't want jsdom really navigating. */
let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  logout.mockClear();
  auth.user = null;
  auth.isLoading = false;
  replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});

afterEach(() => {
  replaceState.mockRestore();
});

describe('dashboard auth guard', () => {
  it('bounces to central once, and sends the mark it just stored out in the return_to', () => {
    const loc = stubLocation('https://app.example.test/board/topic');

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    const mark = sessionStorage.getItem(BOUNCE_KEY);
    expect(mark).toBeTruthy();
    expect(loc.href).toContain('auth.example.test/signin');
    // The return-to is the page they asked for, not the app root.
    expect(decodeURIComponent(loc.href)).toContain('/board/topic');
    // ...carrying THIS tab's mark, so the trip back is provable.
    expect(decodeURIComponent(loc.href)).toContain(`${RETURN_PARAM}=${mark}`);
    expect(screen.queryByText(/don’t have access/i)).toBeNull();
  });

  it('renders neither verdict while the redirect it just started is still in flight', () => {
    const loc = stubLocation('https://app.example.test/board/topic');

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    // The mark is set and the navigation is assigned, but the browser has not
    // unloaded us yet. Deriving the verdict from the mark would paint an
    // accusation over a redirect that is about to succeed.
    expect(sessionStorage.getItem(BOUNCE_KEY)).toBeTruthy();
    expect(loc.href).toContain('auth.example.test/signin');
    expect(screen.queryByText(/don’t have access/i)).toBeNull();
    expect(screen.queryByText(/couldn’t finish signing you in/i)).toBeNull();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('denies only with proof of the round trip: the mark came back on the URL', () => {
    sessionStorage.setItem(BOUNCE_KEY, 'nonce-1');
    const loc = stubLocation(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    // The loop this guard exists to stop.
    expect(loc.href).toBe(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);
    expect(screen.getByText(/don’t have access to this platform/i)).toBeInTheDocument();
    expect(screen.getByText(/isn’t a member of this foundry/i)).toBeInTheDocument();
  });

  it('spends the marker so a reload or a copied link does not re-accuse', () => {
    sessionStorage.setItem(BOUNCE_KEY, 'nonce-1');
    stubLocation(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    expect(replaceState).toHaveBeenCalledWith(null, '', '/board/topic');
  });

  it('a mark with no proof of a return trip is a transient failure, not a denial', () => {
    // The window the old guard got wrong: we set off, and something on the way
    // — a dropped connection, a back button out of central, a restored tab —
    // meant we never came back through it. Nothing here says anything about
    // this account's membership.
    sessionStorage.setItem(BOUNCE_KEY, 'nonce-1');
    const loc = stubLocation('https://app.example.test/board/topic');

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    // The loop this guard exists to stop — still stopped on this branch.
    expect(loc.href).toBe('https://app.example.test/board/topic');
    expect(screen.queryByText(/don’t have access/i)).toBeNull();
    expect(screen.getByText(/couldn’t finish signing you in/i)).toBeInTheDocument();
  });

  it('a marker from someone else’s trip is not proof — it must match this tab’s mark', () => {
    sessionStorage.setItem(BOUNCE_KEY, 'nonce-2');
    const loc = stubLocation(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    expect(loc.href).toBe(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);
    expect(screen.queryByText(/don’t have access/i)).toBeNull();
    expect(screen.getByText(/couldn’t finish signing you in/i)).toBeInTheDocument();
  });

  it('a shared link carrying a marker this tab never issued still just signs you in', () => {
    // No mark: this tab never bounced, so the marker on the URL is someone
    // else's. It must not short-circuit to a verdict.
    const loc = stubLocation(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    expect(loc.href).toContain('auth.example.test/signin');
    expect(screen.queryByText(/don’t have access/i)).toBeNull();
    expect(screen.queryByText(/couldn’t finish signing you in/i)).toBeNull();
  });

  it('renders the app and clears the mark once a session resolves', () => {
    sessionStorage.setItem(BOUNCE_KEY, 'nonce-1');
    const loc = stubLocation(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);
    auth.user = { id: 7, email: 'reviewer@example.test' };

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    expect(sessionStorage.getItem(BOUNCE_KEY)).toBeNull();
    expect(loc.href).toBe(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);
    // The marker is plumbing; it should not survive into the address bar.
    expect(replaceState).toHaveBeenCalledWith(null, '', '/board/topic');
    expect(screen.getByText('board')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('waits while auth is still loading — an unresolved session is not a denial', () => {
    const loc = stubLocation('https://app.example.test/board/topic');
    auth.isLoading = true;

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    expect(sessionStorage.getItem(BOUNCE_KEY)).toBeNull();
    expect(loc.href).toBe('https://app.example.test/board/topic');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('a completed round trip whose session has not resolved yet is not a verdict either', () => {
    // The third state: everything needed to deny is on hand EXCEPT an answer
    // about who this is. A slow resolve must not be read as a fast refusal.
    sessionStorage.setItem(BOUNCE_KEY, 'nonce-1');
    stubLocation(`https://app.example.test/board/topic?${RETURN_PARAM}=nonce-1`);
    auth.isLoading = true;

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/don’t have access/i)).toBeNull();
    expect(screen.queryByText(/couldn’t finish signing you in/i)).toBeNull();
  });

  it('retrying clears the mark so the whole bounce can run again', () => {
    sessionStorage.setItem(BOUNCE_KEY, 'nonce-1');
    const loc = stubLocation('https://app.example.test/board/topic');

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);
    screen.getByRole('button', { name: /try again/i }).click();

    expect(sessionStorage.getItem(BOUNCE_KEY)).toBeNull();
    expect(loc.reload).toHaveBeenCalled();
    // Retry does not itself accuse anyone, and does not log anyone out.
    expect(logout).not.toHaveBeenCalled();
  });
});
