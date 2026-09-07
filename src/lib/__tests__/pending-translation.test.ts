import { describe, expect, it } from 'vitest';

import { pendingTranslation } from '@/lib/draft-translation';

describe('pendingTranslation', () => {
  it('is nothing when nothing was asked for', () => {
    expect(pendingTranslation(null, [])).toBeNull();
    expect(pendingTranslation(null, ['en', 'zh'])).toBeNull();
    expect(pendingTranslation(undefined, ['en'])).toBeNull();
  });

  it('is the requested language while no draft carries it', () => {
    expect(pendingTranslation('zh', ['en'])).toBe('zh');
    expect(pendingTranslation('zh', [])).toBe('zh');
    expect(pendingTranslation('zh', ['en', 'ar'])).toBe('zh');
  });

  it('clears the moment a draft in that language shows up', () => {
    expect(pendingTranslation('zh', ['en', 'zh'])).toBeNull();
  });

  it('answers about the language asked for, not about any new translation', () => {
    // A group can gain `ar` while the reviewer is waiting on `zh` — that is not
    // the arrival they clicked for and must not stop the wait.
    expect(pendingTranslation('zh', ['en', 'ar'])).toBe('zh');
  });

  it('does not treat an empty language on a draft as an arrival', () => {
    expect(pendingTranslation('zh', ['', 'en'])).toBe('zh');
  });
});
