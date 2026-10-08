/**
 * The app shell's rail at phone width (bd startsim-g2m75).
 *
 * At 390px the 240px rail stayed open on every route and left the content
 * column ~52px wide. Below `md` the rail is now hidden (CSS, so the first paint
 * is right) and a menu button opens the same nav as a modal drawer: Escape
 * closes it, choosing a link closes it. jsdom has no viewport, so the widths
 * themselves are proven in Playwright; this pins the behaviour and the classes
 * that decide which of the two shows.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href as string}
      {...rest}
      onClick={(e) => {
        // jsdom can't navigate; the test only cares that the app's handler ran.
        e.preventDefault();
        rest.onClick?.(e);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock('@startsimpli/auth', () => ({
  useAuth: () => ({ user: { email: 'qa@example.test' }, logout: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({ signinUrl: () => 'https://auth.example.test/signin' }));
vi.mock('@/lib/foundry-api', () => ({ listTypes: async () => ({ results: [] }) }));
vi.mock('@/foundry.nav', () => ({
  buildNav: () => [
    { href: '/', label: 'Dashboard' },
    { href: '/activity', label: 'Activity' },
  ],
}));

import { AppSidebar } from '../app-sidebar';

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppSidebar />
    </QueryClientProvider>,
  );
}

const menuButton = () => screen.getByRole('button', { name: /open navigation/i, hidden: true });

describe('AppSidebar at phone width', () => {
  it('hides the fixed rail below md, so it can never squeeze the content column', () => {
    renderSidebar();
    const rail = screen.getByRole('complementary');
    expect(rail).toHaveClass('hidden');
    expect(rail).toHaveClass('md:flex');
  });

  it('offers a menu button that only shows below md', () => {
    renderSidebar();
    const btn = menuButton();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn.closest('.md\\:hidden')).not.toBeNull();
  });

  it('opens the nav in a modal drawer', () => {
    renderSidebar();
    fireEvent.click(menuButton());
    const drawer = screen.getByRole('dialog', { name: /navigation/i });
    expect(within(drawer).getByRole('link', { name: /activity/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderSidebar();
    fireEvent.click(menuButton());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when a nav link is chosen, including the page you are already on', () => {
    renderSidebar();
    fireEvent.click(menuButton());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /dashboard/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
