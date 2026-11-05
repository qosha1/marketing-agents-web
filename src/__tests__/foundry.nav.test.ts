import { describe, it, expect } from 'vitest';
import { buildNav, listTitle } from '@/foundry.nav';
import type { AttributeDef, EntityTypeDef } from '@/lib/foundry-api';

const statusAttr: AttributeDef = {
  id: 's', name: 'status', dataType: 'enum', required: false,
  config: { choices: ['open', 'closed'] },
};

function type(key: string, label: string, attributes: AttributeDef[] = []): EntityTypeDef {
  return { id: key, key, label, attributes };
}

// A representative schema: the content spine (topic), a draft, a status type
// (board), and a plain config type (table).
const contentTypeAttr: AttributeDef = {
  id: 'ct', name: 'content_type', dataType: 'enum', required: false,
  config: { choices: ['weekly_brief', 'lead_magnet', 'general'] },
};
const topic = type('topic', 'Topic', [statusAttr, contentTypeAttr]);
const draft = type('draft', 'Draft');
const deal = type('deal', 'Deal', [statusAttr]); // enum → board
const source = type('source', 'Source'); // no enum → table

/** GroupedNavGroup has `items`; a link does not. */
function isGroup(entry: unknown): entry is { label: string; items: { href: string; label: string }[] } {
  return Array.isArray((entry as { items?: unknown }).items);
}

function group(items: ReturnType<typeof buildNav>, label: string) {
  const g = items.find((e) => isGroup(e) && e.label === label);
  if (!g || !isGroup(g)) throw new Error(`no "${label}" group`);
  return g;
}

describe('buildNav', () => {
  const items = buildNav([topic, draft, deal, source]);

  it('leads with a Dashboard top-level link', () => {
    expect(items[0]).toMatchObject({ href: '/', label: 'Dashboard' });
  });

  it('has no Activity item (Lane 2 removes it from the sidebar)', () => {
    const all = items.flatMap((e) => (isGroup(e) ? e.items : [e as { href: string; label: string }]));
    expect(all.map((i) => i.label)).not.toContain('Activity');
    expect(all.map((i) => i.href)).not.toContain('/activity');
  });

  it('has a Research group: Overview, Topics, Sources, Settings, right after Dashboard', () => {
    expect(items[1]).toMatchObject({ label: 'Research' });
    expect(group(items, 'Research').items.map((i) => ({ href: i.href, label: i.label }))).toEqual([
      { href: '/research', label: 'Overview' },
      { href: '/research/topics', label: 'Topics' },
      { href: '/research/sources', label: 'Sources' },
      { href: '/research/settings', label: 'Settings' },
    ]);
  });

  it('gives the four Research items four different icons', () => {
    const r = group(items, 'Research') as unknown as { items: { icon?: { type: unknown } }[] };
    expect(new Set(r.items.map((i) => i.icon?.type)).size).toBe(4);
  });

  it('lists each content TYPE as its own sidebar item, between Topics and Drafts', () => {
    // The three kinds used to be reachable only as a "Kind:" filter chip inside
    // the Topics table. They are top-level destinations now.
    const content = group(items, 'Content');
    // The v2 pages (All content, Calendar) lead the group; the v1 tables follow.
    expect(content.items.slice(0, 2).map((i) => i.href)).toEqual(['/content', '/content/calendar']);
    expect(content.items.slice(2).map((i) => ({ href: i.href, label: i.label }))).toEqual([
      { href: '/t/topic?content_type=weekly_brief', label: 'Weekly Briefs' },
      // OGMC calls this type "Evergreen" (bd startsim-wn2p.15). Note the href still carries the
      // STORED value `lead_magnet` — relabelling must not touch the value, or every bookmarked
      // link of this form dies and the board silently renders empty instead of erroring.
      { href: '/t/topic?content_type=lead_magnet', label: 'Evergreen' },
      { href: '/t/topic?content_type=general', label: 'General' },
      { href: '/t/draft', label: 'Drafts' },
    ]);
    // Every one is the flat, clickable table route (not the kanban board).
    expect(content.items.slice(2).every((i) => i.href.startsWith('/t/'))).toBe(true);
  });

  it('gives each kind its own icon, so the collapsed rail tells them apart (review bead startsim-uaayw)', () => {
    const content = group(items, 'Content') as unknown as { items: { label: string; icon?: { type: unknown } }[] };
    const kinds = content.items.filter((i) => ['Weekly Briefs', 'Evergreen', 'General'].includes(i.label));
    expect(new Set(kinds.map((i) => i.icon?.type)).size).toBe(3);
  });

  it('reads the kinds from the DECLARED enum, so a new one appears by itself', () => {
    // The whole point of deriving instead of hardcoding: OGMC adding a content
    // type in the schema must not require a code change to be navigable.
    const topic4 = type('topic', 'Topic', [
      statusAttr,
      { ...contentTypeAttr, config: { choices: ['weekly_brief', 'case_study'] } },
    ]);
    const content = group(buildNav([topic4, draft]), 'Content');
    expect(content.items.slice(2).map((i) => i.label)).toEqual([
      'Weekly Briefs', 'Case study', 'Drafts',
    ]);
    expect(content.items[3]!.href).toBe('/t/topic?content_type=case_study');
  });

  it('falls back to Drafts alone when the type declares no content_type', () => {
    const plainTopic = type('topic', 'Topic', [statusAttr]);
    const content = group(buildNav([plainTopic, draft]), 'Content');
    expect(content.items.slice(2).map((i) => i.label)).toEqual(['Drafts']);
  });

  it('lists the OTHER declared types under Data, excluding topic and draft', () => {
    const data = group(items, 'Data');
    const labels = data.items.map((i) => i.label);
    expect(labels).toEqual(['Deal']);
    // Sources and documents live under Research now (Settings, Sources).
    expect(labels).not.toContain('Source');
    expect(labels).not.toContain('Topic'); // covered by Research → Topics
    expect(labels).not.toContain('Draft'); // covered by Content → Drafts
  });

  it('routes a status type to its board and a plain type to its table', () => {
    const other = type('note', 'Note');
    const data = group(buildNav([topic, draft, deal, other]), 'Data');
    expect(data.items.find((i) => i.label === 'Deal')?.href).toBe('/board/deal');
    expect(data.items.find((i) => i.label === 'Note')?.href).toBe('/t/note');
  });

  it('surfaces no About link (scaffold leftover, removed)', () => {
    const hrefs = items.flatMap((e) => (isGroup(e) ? e.items.map((i) => i.href) : [(e as { href: string }).href]));
    expect(hrefs).not.toContain('/about');
    // The last entry is now the Data group, not a trailing static link.
    expect(items[items.length - 1]).toMatchObject({ label: 'Data' });
  });

  it('omits the Data group when there are no other declared types', () => {
    const items2 = buildNav([topic, draft]);
    expect(items2.some((e) => isGroup(e) && e.label === 'Data')).toBe(false);
    // Content group + static links still render.
    expect(items2.some((e) => isGroup(e) && e.label === 'Content')).toBe(true);
  });

  it('still renders without any declared types (schema not yet loaded)', () => {
    const items3 = buildNav([]);
    expect(items3[0]).toMatchObject({ href: '/', label: 'Dashboard' });
    // With no schema there are no declared kinds — Drafts still renders, and Research always does.
    expect(group(items3, 'Content').items.slice(2).map((i) => i.label)).toEqual(['Drafts']);
    expect(group(items3, 'Research').items).toHaveLength(4);
  });
});

describe('listTitle — a records table is titled what its nav item says (startsim-g7x59)', () => {
  it('names Topics and Drafts in the plural, as the sidebar does', () => {
    expect(listTitle({ key: 'topic', label: 'Topic' })).toBe('Topics');
    expect(listTitle({ key: 'draft', label: 'Draft' })).toBe('Drafts');
  });
  it('leaves every other type on its own label, which is also its nav label', () => {
    expect(listTitle({ key: 'source', label: 'Approved Source' })).toBe('Approved Source');
  });
});
