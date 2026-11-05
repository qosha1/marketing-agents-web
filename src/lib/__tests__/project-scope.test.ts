/**
 * Active project scope (bd startsim-c65fd / startsim-4ma5a). The stored value is
 * a scope path; null means All.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getActiveProjectId,
  setActiveProjectId,
  scopeFiltersFor,
  stampActiveProject,
  switcherOptions,
  ACTIVE_PROJECT_KEY,
} from '@/lib/project-scope';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const scoped = { key: 'topic', config: { scope: { pathAttribute: 'scope_path' } } };
const unscoped = { key: 'news_item', config: { scope: { pathAttribute: null } } };
const undeclared = { key: 'client', config: {} };

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeStorage(), dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});

describe('active project', () => {
  it('is null (All) until one is chosen, and the signature stays () => string | null', () => {
    expect(getActiveProjectId()).toBeNull();
  });

  it('survives a reload: it is read back from storage', () => {
    setActiveProjectId('/ogmc');
    expect(getActiveProjectId()).toBe('/ogmc');
    expect(window.localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe('/ogmc');
    setActiveProjectId(null);
    expect(getActiveProjectId()).toBeNull();
  });

  it('is null on the server and when storage throws', () => {
    vi.stubGlobal('window', undefined);
    expect(getActiveProjectId()).toBeNull();
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked'); } } });
    expect(getActiveProjectId()).toBeNull();
  });
});

describe('scopeFiltersFor: choosing a project filters every list and count to it', () => {
  it('adds ?scope= for a scoped type', () => {
    expect(scopeFiltersFor(scoped, '/ogmc')).toEqual({ scope: '/ogmc' });
  });
  it('adds nothing for All', () => {
    expect(scopeFiltersFor(scoped, null)).toEqual({});
  });
  it('adds nothing for an unscoped or undeclared type (the tenant would answer 400)', () => {
    expect(scopeFiltersFor(unscoped, '/ogmc')).toEqual({});
    expect(scopeFiltersFor(undeclared, '/ogmc')).toEqual({});
    expect(scopeFiltersFor(undefined, '/ogmc')).toEqual({});
  });
});

describe('stampActiveProject: creating a record stamps the active project', () => {
  it('writes scope_path for a scoped type', () => {
    expect(stampActiveProject(scoped, { title: 'x' }, '/ogmc')).toEqual({ title: 'x', scope_path: '/ogmc' });
  });
  it('never invents a path: no active project, or an unscoped type, leaves data alone', () => {
    expect(stampActiveProject(scoped, { title: 'x' }, null)).toEqual({ title: 'x' });
    expect(stampActiveProject(unscoped, { title: 'x' }, '/ogmc')).toEqual({ title: 'x' });
  });
  it('does not overwrite a path the caller already set', () => {
    expect(stampActiveProject(scoped, { scope_path: '/other' }, '/ogmc')).toEqual({ scope_path: '/other' });
  });
});

describe('switcherOptions', () => {
  const row = (name: string, path: string, kind: string, parent = '') => ({
    id: 1, entityType: 'scope', externalId: null, name, createdAt: '',
    data: { name, path, kind, parent, active: true },
  });
  it('lists top-level scopes only: clients, and solo projects as their own root', () => {
    const opts = switcherOptions([
      row('OGMC', '/ogmc', 'client'),
      row('GCC Weekly', '/ogmc/gcc-weekly', 'project', '/ogmc'),
      row('My Blog', '/my-blog', 'project'),
    ]);
    expect(opts).toEqual([
      { path: '/ogmc', label: 'OGMC' },
      { path: '/my-blog', label: 'My Blog' },
    ]);
  });
  it('a user with one choice gets no choice to make', () => {
    expect(switcherOptions([row('My Blog', '/my-blog', 'project')])).toHaveLength(1);
  });
});
