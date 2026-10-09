/**
 * The page half of an accept (bd startsim-q8sgy). An accept moves the record's
 * text and version on the SERVER; the page PATCHes its whole blob from its own
 * section copy. If the copy kept the pre-accept text, the next scorecard
 * autosave would put the old text straight back over the accept. These pin the
 * fold, the viewer rule, and the client's URLs.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/auth', () => ({ getRegisteredToken: async () => 'tok' }));

import { canEditRecord, canEditRecords, foldAccepted, trackChangesClient, trackedText, withTrackedText } from '../track-changes';

describe('foldAccepted + withTrackedText', () => {
  const sections = [
    { key: 'blog', value: 'Old blog.' },
    { key: 'linkedin', value: 'Old post.' },
    { key: 'seo', value: { title: 't' } },
  ];

  it('takes the accepted text and version off the accept answer', () => {
    const f = foldAccepted({ id: 'd', version: 7, data: { blog: 'New blog.', linkedin: 'Old post.', seo: {} } });
    expect(f).toEqual({ text: { blog: 'New blog.', linkedin: 'Old post.' }, version: 7 });
  });

  it('replaces only the tracked fields, so the next whole-blob write carries the accepted text', () => {
    const f = foldAccepted({ version: 7, data: { blog: 'New blog.', linkedin: 'Old post.' } });
    const next = withTrackedText(sections, f.text);
    expect(next).toEqual([
      { key: 'blog', value: 'New blog.' },
      { key: 'linkedin', value: 'Old post.' },
      { key: 'seo', value: { title: 't' } },
    ]);
    // Simulate the page's mergedData() for a scorecard autosave after the accept.
    const body: Record<string, unknown> = { ...Object.fromEntries(next.map((s) => [s.key, s.value])), review: { verdict: "approve" } };
    expect(body.blog).toBe('New blog.');
  });

  it('reads a missing field as empty, never undefined', () => {
    expect(trackedText({})).toEqual({ blog: '', linkedin: '' });
  });
});

describe('canEditRecords', () => {
  it('lets every role but viewer edit', () => {
    expect(canEditRecords('admin')).toBe(true);
    expect(canEditRecords('member')).toBe(true);
    expect(canEditRecords('viewer')).toBe(false);
    expect(canEditRecords(undefined)).toBe(false);
  });
});

describe('trackChangesClient', () => {
  it('speaks the tenant routes with the raw bearer and no trailing slash', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: 3 }) });
    vi.stubGlobal('fetch', f);
    try {
      await trackChangesClient('d1').accept!({ ids: ['s1'], expectedVersion: 3 });
      const [url, init] = f.mock.calls[0];
      expect(url).toBe('/api/v1/entities/d1/suggestions/accept');
      expect(init.headers.authorization).toMatch(/tok$/);
      expect(JSON.parse(init.body)).toEqual({ ids: ['s1'], expected_version: 3 });
      await trackChangesClient('d1').listSuggestions!({ field: 'blog' });
      expect(f.mock.calls[1][0]).toBe('/api/v1/entities/d1/suggestions?field=blog');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe('canEditRecord (bd startsim-768w.71)', () => {
  it("follows the record's own answer over the role", () => {
    expect(canEditRecord({ permissions: { canEdit: true } }, 'viewer')).toBe(true);
    expect(canEditRecord({ permissions: { canEdit: false } }, 'admin')).toBe(false);
  });

  it('falls back to the role for a tenant that sends no permissions', () => {
    expect(canEditRecord({}, 'member')).toBe(true);
    expect(canEditRecord({ permissions: null }, 'viewer')).toBe(false);
  });
});
