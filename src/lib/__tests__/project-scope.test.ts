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
  describeActive,
  switcherModel,
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

describe('switcherModel', () => {
  let n = 0;
  const row = (name: string, path: string, kind: string, parent = '', active = true) => ({
    id: ++n, entityType: 'scope', externalId: null, name, createdAt: '',
    data: { name, path, kind, parent, active },
  });
  const scopes = [
    row('Acme', '/acme', 'client'),
    row('Launch', '/acme/launch', 'project', '/acme'),
    row('Newsletter', '/acme/newsletter', 'project', '/acme'),
    row('Field Notes', '/field-notes', 'project'),
    row('Bare Client', '/bare', 'client'),
    row('Old', '/old', 'project', '', false),
  ];

  it('lists projects of your own first, then each client with its projects; clients with none and archived ones are left out', () => {
    const m = switcherModel(scopes);
    expect(m.solo.map((p) => p.path)).toEqual(['/field-notes']);
    expect(m.clients.map((c) => [c.name, c.projects.map((p) => p.path)])).toEqual([
      ['Acme', ['/acme/launch', '/acme/newsletter']],
    ]);
    expect(m.projects.map((p) => p.path)).toEqual(['/field-notes', '/acme/launch', '/acme/newsletter']);
    expect(m.hasClients).toBe(true);
  });

  it('with no client anywhere it is a flat list', () => {
    const m = switcherModel([row('Field Notes', '/field-notes', 'project')]);
    expect(m.hasClients).toBe(false);
    expect(m.clients).toEqual([]);
    expect(m.solo).toHaveLength(1);
  });

  it('a project whose parent is not a client is treated as your own, so it cannot vanish', () => {
    const m = switcherModel([row('Orphan', '/gone/orphan', 'project', '/gone')]);
    expect(m.solo.map((p) => p.path)).toEqual(['/gone/orphan']);
  });

  it('describes the active project, with its client as the caption', () => {
    const m = switcherModel(scopes);
    expect(describeActive(scopes, m, '/acme/launch')).toEqual({ label: 'Launch', caption: 'Acme' });
    expect(describeActive(scopes, m, '/field-notes')).toEqual({ label: 'Field Notes', caption: 'Project' });
  });

  it('still understands a client path saved by the old switcher, and drops one that names nothing', () => {
    const m = switcherModel(scopes);
    expect(describeActive(scopes, m, '/acme')).toEqual({ label: 'Acme', caption: 'Client' });
    expect(describeActive(scopes, m, '/deleted')).toBeNull();
    expect(describeActive(scopes, m, null)).toBeNull();
  });
});
