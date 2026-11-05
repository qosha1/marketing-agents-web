/**
 * The project entity (bd startsim-obqlq / startsim-qbgng, epic startsim-oefxl).
 *
 * A project is a `scope` row with kind='project'. A client is a root scope with
 * kind='client'. A project under a client has parent=<client path>; a solo
 * project is a root scope (parent='').
 */
import { describe, expect, it } from 'vitest';

import {
  BRIEF_ATTR,
  PROJECT_KIND,
  buildProjectInput,
  defaultProjectInput,
  needsDefaultProject,
  projectPath,
  projectRow,
  sourcesBelong,
} from '@/lib/projects';
import type { EntityRecord } from '@/lib/foundry-api';

function scope(data: Record<string, unknown>, id = 1): EntityRecord {
  return {
    id,
    entityType: 'scope',
    externalId: `scope:${String(data.path)}`,
    name: String(data.name),
    data,
    createdAt: '2026-11-04T00:00:00Z',
  };
}

describe('project entity', () => {
  it('is a scope row of kind project with a name and a brief attribute', () => {
    const input = buildProjectInput({ name: 'GCC Weekly', clientPath: null, takenPaths: [] });
    expect(input.entityType).toBe('scope');
    expect(input.name).toBe('GCC Weekly');
    expect(input.data).toMatchObject({ name: 'GCC Weekly', kind: PROJECT_KIND, active: true });
    expect(BRIEF_ATTR).toBe('brand_voice');
  });

  it('may have zero clients: a solo project is a root scope', () => {
    const input = buildProjectInput({ name: 'My Blog', clientPath: null, takenPaths: [] });
    expect(input.data).toMatchObject({ path: '/my-blog', parent: '' });
  });

  it('links to a client by nesting under the client path', () => {
    const input = buildProjectInput({ name: 'GCC Weekly', clientPath: '/ogmc', takenPaths: [] });
    expect(input.data).toMatchObject({ path: '/ogmc/gcc-weekly', parent: '/ogmc' });
  });

  it('requires a name', () => {
    expect(() => buildProjectInput({ name: '   ', clientPath: null, takenPaths: [] })).toThrow(/name/i);
  });

  it('never reuses a path that is taken (a client, a sibling)', () => {
    expect(projectPath('OGMC', null, ['/ogmc'])).toBe('/ogmc-2');
    expect(projectPath('OGMC', null, ['/ogmc', '/ogmc-2'])).toBe('/ogmc-3');
    expect(projectPath('Weekly', '/ogmc', ['/ogmc/weekly'])).toBe('/ogmc/weekly-2');
  });

  it('turns punctuation and accents into a clean slug, never an empty one', () => {
    expect(projectPath('  Q4: Café & Co.!  ', null, [])).toBe('/q4-cafe-co');
    expect(projectPath('!!!', null, [])).toBe('/project');
  });

  it('a first-time user with no scopes at all is given a default project named from their account', () => {
    expect(needsDefaultProject(0)).toBe(true);
    // OGMC has a client scope and no projects yet: it must NOT get a surprise project.
    expect(needsDefaultProject(1)).toBe(false);
    const input = defaultProjectInput({ name: 'Quinn Osha', email: 'quinn@example.com' });
    expect(input.name).toBe("Quinn Osha's project");
    expect(input.data).toMatchObject({ kind: PROJECT_KIND, parent: '' });
    expect(defaultProjectInput({ email: 'quinn@example.com' }).name).toBe("quinn's project");
    expect(defaultProjectInput({}).name).toBe('My project');
  });

  it('a project row names its client, blank when it has none, and reads the brief', () => {
    const clients = new Map([['/ogmc', 'OGMC']]);
    const withClient = projectRow(
      scope({ name: 'GCC Weekly', kind: 'project', path: '/ogmc/gcc-weekly', parent: '/ogmc', [BRIEF_ATTR]: 'Weekly GCC news' }),
      clients,
    );
    expect(withClient).toMatchObject({ name: 'GCC Weekly', client: 'OGMC', clientPath: '/ogmc', brief: 'Weekly GCC news' });
    const solo = projectRow(scope({ name: 'My Blog', kind: 'project', path: '/my-blog', parent: '' }), clients);
    expect(solo).toMatchObject({ client: null, clientPath: null, brief: '' });
  });

  it('every source, topic and draft belongs to exactly one project: a row belongs to a project when its scope_path is the path or under it', () => {
    expect(sourcesBelong('/ogmc/gcc-weekly', '/ogmc/gcc-weekly')).toBe(true);
    expect(sourcesBelong('/ogmc/gcc-weekly/x', '/ogmc/gcc-weekly')).toBe(true);
    expect(sourcesBelong('/ogmc/gcc-weekly-old', '/ogmc/gcc-weekly')).toBe(false);
    expect(sourcesBelong(undefined, '/ogmc/gcc-weekly')).toBe(false);
  });
});

import { PROJECTS_PAGE_SIZE, SOLO_CLIENT, projectListFilters } from '@/lib/projects';

describe('projectListFilters (startsim-kqwmm: server-side search, sort, filter, page)', () => {
  it('always narrows to projects and pages server-side', () => {
    expect(projectListFilters({})).toEqual({
      'attr.kind': PROJECT_KIND,
      page_size: String(PROJECTS_PAGE_SIZE),
      order: 'attr.name',
    });
  });

  it('searches by name with a substring match, and a blank box sends nothing', () => {
    expect(projectListFilters({ search: ' gcc ' })['attr.name__icontains']).toBe('gcc');
    expect('attr.name__icontains' in projectListFilters({ search: '  ' })).toBe(false);
  });

  it('sorts by name or client, either direction', () => {
    expect(projectListFilters({ sortBy: 'name', sortDirection: 'desc' }).order).toBe('-attr.name');
    expect(projectListFilters({ sortBy: 'client', sortDirection: 'asc' }).order).toBe('attr.parent');
    expect(projectListFilters({ sortBy: 'client', sortDirection: 'desc' }).order).toBe('-attr.parent');
    // Sources has no server-side value yet: it falls back to the default order.
    expect(projectListFilters({ sortBy: 'sources', sortDirection: 'desc' }).order).toBe('attr.name');
  });

  it('filters to one client, or to projects with no client', () => {
    expect(projectListFilters({ clientPath: '/ogmc' })['attr.parent']).toBe('/ogmc');
    expect(projectListFilters({ clientPath: SOLO_CLIENT })['attr.parent']).toBe('');
  });
});
