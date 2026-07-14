import { describe, it, expect } from 'vitest';
import { buildNav } from '@/foundry.nav';
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
const topic = type('topic', 'Topic', [statusAttr]);
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

  it('builds a Content group of two data tables: Topics + Drafts', () => {
    const content = group(items, 'Content');
    expect(content.items.map((i) => ({ href: i.href, label: i.label }))).toEqual([
      { href: '/t/topic', label: 'Topics' },
      { href: '/t/draft', label: 'Drafts' },
    ]);
    // Both are the flat, clickable table route (not the kanban board).
    expect(content.items.every((i) => i.href.startsWith('/t/'))).toBe(true);
  });

  it('lists the OTHER declared types under Data, excluding topic and draft', () => {
    const data = group(items, 'Data');
    const labels = data.items.map((i) => i.label);
    expect(labels).toEqual(['Deal', 'Source']);
    expect(labels).not.toContain('Topic'); // covered by Content → Topics
    expect(labels).not.toContain('Draft'); // covered by Content → Drafts
  });

  it('routes a status type to its board and a plain type to its table', () => {
    const data = group(items, 'Data');
    expect(data.items.find((i) => i.label === 'Deal')?.href).toBe('/board/deal');
    expect(data.items.find((i) => i.label === 'Source')?.href).toBe('/t/source');
  });

  it('keeps a trailing About link', () => {
    expect(items[items.length - 1]).toMatchObject({ href: '/about', label: 'About' });
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
    // The Content group's two static tables render regardless of schema load.
    expect(group(items3, 'Content').items.map((i) => i.label)).toEqual(['Topics', 'Drafts']);
  });
});
