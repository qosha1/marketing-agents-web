import { describe, it, expect } from 'vitest';
import { buildNav, isNavParent, listTitle } from '@/foundry.nav';

/** Wireframe C01: Dashboard, Content, Projects, then Research with its four pages. */
describe('buildNav', () => {
  const items = buildNav();

  it('is the short fixed rail, in the wireframe order', () => {
    expect(items.map((e) => ({ href: e.href, label: e.label }))).toEqual([
      { href: '/', label: 'Dashboard' },
      { href: '/content', label: 'Content' },
      { href: '/projects', label: 'Projects' },
      { href: '/research', label: 'Research' },
    ]);
  });

  it('opens Research to Overview, Topics, Sources, Settings', () => {
    const research = items.find((e) => e.label === 'Research')!;
    expect(isNavParent(research)).toBe(true);
    expect(isNavParent(research) && research.items.map((i) => ({ href: i.href, label: i.label }))).toEqual([
      { href: '/research', label: 'Overview' },
      { href: '/research/topics', label: 'Topics' },
      { href: '/research/sources', label: 'Sources' },
      { href: '/research/settings', label: 'Settings' },
    ]);
  });

  it('lists nothing the wireframe does not show: no Activity, no Data group, no content kinds, no Drafts', () => {
    const all = items.flatMap((e) => (isNavParent(e) ? [e, ...e.items] : [e]));
    const labels = all.map((i) => i.label);
    for (const gone of ['Activity', 'Data', 'Drafts', 'Calendar', 'All content', 'Weekly Briefs', 'Evergreen', 'General', 'Client']) {
      expect(labels).not.toContain(gone);
    }
    expect(all.map((i) => i.href)).not.toContain('/activity');
  });

  it('keeps the draft editor under Content', () => {
    expect(items.find((e) => e.label === 'Content')?.alsoActiveOn).toContain('/draft');
  });
});

describe('listTitle — a records table is titled what its nav item says (startsim-g7x59)', () => {
  it('names Topics and Drafts in the plural', () => {
    expect(listTitle({ key: 'topic', label: 'Topic' })).toBe('Topics');
    expect(listTitle({ key: 'draft', label: 'Draft' })).toBe('Drafts');
  });
  it('leaves every other type on its own label', () => {
    expect(listTitle({ key: 'source', label: 'Approved Source' })).toBe('Approved Source');
  });
});
