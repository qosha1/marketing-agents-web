/**
 * The tenant-auth bounce guard (bd startsim-mcoza).
 *
 * This layout decides, for every dashboard page, between three outcomes: send
 * the visitor to central to sign in, tell them they are not a member of THIS
 * foundry, or render the app. Getting it wrong either locks a legitimate
 * reviewer out or traps them in a redirect loop, and neither shows up in a
 * type-check. These are characterisation tests: they pin the behaviour that
 * exists so the ref/effect cleanup underneath it can be proven not to change it.
 *
 * They are also what closed the question in startsim-mcoza. The lint error on
 * `setDenied` is suppressed rather than fixed because the derived version — read
 * the mark during render via `useSyncExternalStore` — went RED here: after the
 * bounce sets the mark, the next render paints "You don't have access" over a
 * redirect that is still in flight. Caching the read to stop that reopens the
 * double-bounce loop across hydration, where `getServerSnapshot` reports "not
 * bounced" on a load that had. Anyone reaching for that refactor again should
 * re-add a test for the redirect-in-flight window first; it is the one these
 * four do not cover.
 */
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BOUNCE_KEY = 'ss_tenant_auth_bounced';

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

/** jsdom refuses real navigation, so stand in for `window.location`. */
function stubLocation(href: string) {
  const loc = { href, origin: new URL(href).origin };
  vi.stubGlobal('location', loc);
  return loc;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  logout.mockClear();
  auth.user = null;
  auth.isLoading = false;
});

describe('dashboard auth guard', () => {
  it('bounces to central once, marking that it did', () => {
    const loc = stubLocation('https://app.example.test/board/topic');

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    expect(sessionStorage.getItem(BOUNCE_KEY)).toBe('1');
    expect(loc.href).toContain('auth.example.test/signin');
    // The return-to is the page they asked for, not the app root.
    expect(decodeURIComponent(loc.href)).toContain('/board/topic');
    expect(screen.queryByText(/don’t have access/i)).toBeNull();
  });

  it('stops after one bounce: no session and the mark already set is a denial, not another redirect', () => {
    sessionStorage.setItem(BOUNCE_KEY, '1');
    const loc = stubLocation('https://app.example.test/board/topic');

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    // The loop this guard exists to stop.
    expect(loc.href).toBe('https://app.example.test/board/topic');
    expect(screen.getByText(/don’t have access to this platform/i)).toBeInTheDocument();
  });

  it('renders the app and clears the mark once a session resolves', () => {
    sessionStorage.setItem(BOUNCE_KEY, '1');
    const loc = stubLocation('https://app.example.test/board/topic');
    auth.user = { id: 7, email: 'reviewer@example.test' };

    render(<DashboardLayout>{<p>board</p>}</DashboardLayout>);

    expect(sessionStorage.getItem(BOUNCE_KEY)).toBeNull();
    expect(loc.href).toBe('https://app.example.test/board/topic');
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
});
