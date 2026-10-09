import { describe, it, expect } from 'vitest';
import { CHANNEL_IDS, isChannelId } from '../draft-channels';

describe('isChannelId', () => {
  it('accepts the content pane channels and nothing else', () => {
    expect(CHANNEL_IDS).toEqual(['brief', 'linkedin', 'seo', 'sources']);
    expect(isChannelId('sources')).toBe(true);
    expect(isChannelId('nope')).toBe(false);
    expect(isChannelId(null)).toBe(false);
  });
});
