import { describe, it, expect } from 'vitest';
import { matchTopicDrafts, draftTitle, draftStatus, WRITTEN_FOR } from '../topic-drafts';
import type { EntityRecord, RelationshipRecord } from '@/lib/foundry-api';

function draft(id: number, data: Record<string, unknown> = {}, name = 'd' + id): EntityRecord {
  return { id, entityType: 'draft', externalId: null, name, data, createdAt: '2026-07-01' };
}
function edge(id: number, relType: string, source: number, target: number): RelationshipRecord {
  return { id, relType, source, target };
}

describe('matchTopicDrafts', () => {
  const drafts = [draft(10), draft(11), draft(12)];

  it('returns drafts whose written_for edge targets the topic', () => {
    const rels = [
      edge(1, WRITTEN_FOR, 10, 100),
      edge(2, WRITTEN_FOR, 11, 100),
      edge(3, WRITTEN_FOR, 12, 200), // written for a different topic
    ];
    expect(matchTopicDrafts(100, rels, drafts).map((d) => d.id)).toEqual([10, 11]);
  });

  it('ignores edges of a different rel type', () => {
    const rels = [edge(1, 'mentions', 10, 100), edge(2, WRITTEN_FOR, 11, 100)];
    expect(matchTopicDrafts(100, rels, drafts).map((d) => d.id)).toEqual([11]);
  });

  it('preserves the input order of drafts, not the edge order', () => {
    const rels = [edge(1, WRITTEN_FOR, 12, 100), edge(2, WRITTEN_FOR, 10, 100)];
    expect(matchTopicDrafts(100, rels, drafts).map((d) => d.id)).toEqual([10, 12]);
  });

  it('is empty when no edge targets the topic', () => {
    expect(matchTopicDrafts(999, [edge(1, WRITTEN_FOR, 10, 100)], drafts)).toEqual([]);
    expect(matchTopicDrafts(100, [], drafts)).toEqual([]);
  });

  it('skips edges whose source is not among the known draft records', () => {
    expect(matchTopicDrafts(100, [edge(1, WRITTEN_FOR, 55, 100)], drafts)).toEqual([]);
  });
});

describe('draftTitle', () => {
  it('prefers story_title (camelCased blob key)', () => {
    expect(draftTitle(draft(1, { storyTitle: 'Big News' }))).toBe('Big News');
  });
  it('reads the snake_case key too', () => {
    expect(draftTitle(draft(1, { story_title: 'Snake News' }))).toBe('Snake News');
  });
  it('falls back to the record name, then the id', () => {
    expect(draftTitle(draft(7, {}, 'Fallback Name'))).toBe('Fallback Name');
    expect(draftTitle(draft(7, {}, ''))).toBe('#7');
  });
});

describe('draftStatus', () => {
  it('reads the status blob value', () => {
    expect(draftStatus(draft(1, { status: 'ready' }))).toBe('ready');
  });
  it('is empty when unset', () => {
    expect(draftStatus(draft(1, {}))).toBe('');
  });
});
