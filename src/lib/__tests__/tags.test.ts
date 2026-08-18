import { describe, it, expect } from 'vitest';
import { findTag, GOOD_EXAMPLE_LABEL } from '../tags';
import type { TagRecord } from '../foundry-api';

function tag(id: number, entity: number, label: string): TagRecord {
  return { id, entity, label, createdAt: '2026-07-01' };
}

describe('findTag', () => {
  it('finds the tag matching both entity and label', () => {
    const tags = [tag(1, 10, GOOD_EXAMPLE_LABEL), tag(2, 11, GOOD_EXAMPLE_LABEL), tag(3, 10, 'other')];
    expect(findTag(tags, 10, GOOD_EXAMPLE_LABEL)?.id).toBe(1);
  });
  it('is undefined when no tag matches', () => {
    const tags = [tag(1, 11, GOOD_EXAMPLE_LABEL)];
    expect(findTag(tags, 10, GOOD_EXAMPLE_LABEL)).toBeUndefined();
    expect(findTag([], 10, GOOD_EXAMPLE_LABEL)).toBeUndefined();
  });
  it('compares entity ids as strings (UUID pks, not just numbers)', () => {
    const tags = [tag(1, 'abc-123' as unknown as number, GOOD_EXAMPLE_LABEL)];
    expect(findTag(tags, 'abc-123', GOOD_EXAMPLE_LABEL)?.id).toBe(1);
  });
});
