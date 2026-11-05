import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@startsimpli/auth', () => ({ useAuth: () => ({ user: { email: 'quinn@example.com' } }) }));
const listAllEntities = vi.fn();
const ensureDefaultProject = vi.fn();
vi.mock('@/lib/foundry-api', () => ({ listAllEntities: (...a: unknown[]) => listAllEntities(...a) }));
vi.mock('@/lib/projects-api', () => ({ ensureDefaultProject: (...a: unknown[]) => ensureDefaultProject(...a) }));

import { ProjectSwitcher } from '../project-switcher';
import { getActiveProjectId, setActiveProjectId } from '@/lib/project-scope';

const row = (id: number, name: string, path: string, kind: string, parent = '') => ({
  id, entityType: 'scope', externalId: null, name, createdAt: '', data: { name, path, kind, parent, active: true },
});

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProjectSwitcher /></QueryClientProvider>);
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true });
  listAllEntities.mockReset();
  ensureDefaultProject.mockReset().mockResolvedValue(null);
});

describe('ProjectSwitcher', () => {
  it('lists All plus each top-level scope, and remembers the choice', async () => {
    listAllEntities.mockResolvedValue([row(1, 'OGMC', '/ogmc', 'client'), row(2, 'My Blog', '/my-blog', 'project'), row(3, 'GCC', '/ogmc/gcc', 'project', '/ogmc')]);
    renderIt();
    const select = (await screen.findByLabelText('Project')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['All', 'OGMC', 'My Blog']);
    await userEvent.selectOptions(select, '/ogmc');
    expect(getActiveProjectId()).toBe('/ogmc');
    await userEvent.selectOptions(select, '');
    expect(getActiveProjectId()).toBeNull();
  });

  it('shows the stored choice after a reload', async () => {
    setActiveProjectId('/my-blog');
    listAllEntities.mockResolvedValue([row(1, 'OGMC', '/ogmc', 'client'), row(2, 'My Blog', '/my-blog', 'project')]);
    renderIt();
    expect(((await screen.findByLabelText('Project')) as HTMLSelectElement).value).toBe('/my-blog');
  });

  it('a user with one project gets no switcher', async () => {
    listAllEntities.mockResolvedValue([row(2, 'My Blog', '/my-blog', 'project')]);
    renderIt();
    await waitFor(() => expect(listAllEntities).toHaveBeenCalled());
    expect(screen.queryByLabelText('Project')).toBeNull();
    expect(ensureDefaultProject).not.toHaveBeenCalled();
  });

  it('a first-time user with no scopes at all is given a default project', async () => {
    listAllEntities.mockResolvedValue([]);
    renderIt();
    await waitFor(() => expect(ensureDefaultProject).toHaveBeenCalledWith({ name: undefined, email: 'quinn@example.com' }));
  });
});
