/**
 * OGMC's standing check policy (bd startsim-wncr6). The RESOLVER is tested in
 * @startsimpli/ui; what is tested here is OUR policy — that the one band the
 * team actually gave us is applied to the right content type, and that the
 * types they have not priced yet fall back rather than silently losing a check.
 */
import { describe, expect, it } from 'vitest';
import { resolveCheckPolicy, runContentChecks } from '@startsimpli/ui';

import { OGMC_CHECK_POLICY } from '../content-checks';

const blogOf = (contentType: string, language = 'en') =>
  resolveCheckPolicy(OGMC_CHECK_POLICY, { contentType, language }).blogWords;

describe('OGMC_CHECK_POLICY', () => {
  it('applies the 400-500 band the team gave us to weekly briefs', () => {
    expect(blogOf('weekly_brief')).toEqual([400, 500]);
  });

  it('does NOT price evergreen or general — we were never given their numbers', () => {
    // Absent, not invented. bd startsim-ozpjw.3 is the ask. If this ever starts
    // returning a band, someone has guessed on OGMC's behalf.
    expect(blogOf('lead_magnet')).toBeUndefined();
    expect(blogOf('general')).toBeUndefined();
  });

  it('keys evergreen on its STORED value, so a policy for "evergreen" is a no-op', () => {
    // The label is "Evergreen"; the stored content_type is `lead_magnet`
    // (src/lib/content.ts). A rule written against the label would match nothing
    // and silently drop evergreen drafts back to the brief band.
    expect(blogOf('evergreen')).toBeUndefined();
  });

  it('falls back to the package defaults for an unknown type — never to no check', () => {
    const checks = runContentChecks(
      { blog: 'word '.repeat(450).trim() },
      resolveCheckPolicy(OGMC_CHECK_POLICY, { contentType: 'something_new' }),
    );
    const blog = checks.find((c) => c.id === 'blog-words');
    expect(blog).toBeDefined();
    expect(blog?.status).toBe('pass');
  });

  it('a brief that misses the band says which way it missed', () => {
    const checks = runContentChecks(
      { blog: 'word '.repeat(506).trim() },
      resolveCheckPolicy(OGMC_CHECK_POLICY, { contentType: 'weekly_brief' }),
    );
    // The 2026-08-25 meeting: the rail said "506 words" and nobody in the room
    // could tell it meant six OVER a 400-500 band (bd startsim-ztlz7).
    const blog = checks.find((c) => c.id === 'blog-words');
    expect(blog?.status).not.toBe('pass');
    expect(blog?.detail).toContain('over');
    expect(blog?.detail).toContain('400');
  });
});
