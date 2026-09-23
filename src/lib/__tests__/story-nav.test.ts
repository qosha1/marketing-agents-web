/**
 * Where a topic decision goes, and where "back" comes back to (bd startsim-z384k).
 *
 * Two things are being pinned here and they are different kinds of risk.
 *
 * THE FIRST IS SECURITY. `from` is a string off the address bar that this app
 * turns into an href. Every accepted shape widens what a crafted link can do, so
 * the refusals are the test — an absolute url, a protocol-relative host, a
 * backslash, a route that is not a list — not the happy path.
 *
 * THE SECOND IS startsim-uhmk REPEATING ITSELF. That bead was this exact link
 * reading "... board" while pointing at the table. The label and the href are
 * returned together by one function precisely so they cannot be set apart, and
 * these cases assert the pairing rather than either half.
 */
import { describe, expect, it } from 'vitest';

import {
  currentReturnPath,
  draftHref,
  returnTarget,
  safeReturnPath,
  storyHref,
} from '../story-nav';

describe('safeReturnPath', () => {
  it('accepts a table path with its whole query string', () => {
    expect(safeReturnPath('/t/topic?content_type=lead_magnet&status=suggested')).toBe(
      '/t/topic?content_type=lead_magnet&status=suggested',
    );
  });

  it('accepts a board path', () => {
    expect(safeReturnPath('/board/topic?content_type=weekly_brief')).toBe(
      '/board/topic?content_type=weekly_brief',
    );
  });

  it('refuses an absolute url — that is a way off the app', () => {
    expect(safeReturnPath('https://evil.example/t/topic')).toBeNull();
    expect(safeReturnPath('http://evil.example')).toBeNull();
  });

  it('refuses a protocol-relative host', () => {
    expect(safeReturnPath('//evil.example/t/topic')).toBeNull();
  });

  it('refuses a backslash — some browsers normalise it to a slash', () => {
    expect(safeReturnPath('/\\evil.example')).toBeNull();
    expect(safeReturnPath('\\\\evil.example')).toBeNull();
  });

  it('refuses a route that is not one of the two list routes', () => {
    expect(safeReturnPath('/draft/abc')).toBeNull();
    expect(safeReturnPath('/actions/generate-drafts')).toBeNull();
    expect(safeReturnPath('/')).toBeNull();
    // `/troom` must not pass as `/t/` — the same prefix trap view-toggle guards.
    expect(safeReturnPath('/troom')).toBeNull();
  });

  it('refuses control characters and absurd lengths', () => {
    expect(safeReturnPath('/t/topic\nSet-Cookie: x')).toBeNull();
    expect(safeReturnPath(`/t/topic?q=${'a'.repeat(4000)}`)).toBeNull();
  });

  it('is null for nothing at all', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
  });
});

describe('currentReturnPath', () => {
  it('joins the path and the query the way the address bar shows them', () => {
    expect(currentReturnPath('/t/topic', 'content_type=general')).toBe(
      '/t/topic?content_type=general',
    );
    expect(currentReturnPath('/t/topic', '?content_type=general')).toBe(
      '/t/topic?content_type=general',
    );
  });

  it('leaves a bare path bare rather than trailing a lone question mark', () => {
    expect(currentReturnPath('/t/topic', '')).toBe('/t/topic');
  });
});

describe('storyHref / draftHref', () => {
  it('carries a valid return path, encoded', () => {
    expect(storyHref('abc-123', '/t/topic?content_type=general')).toBe(
      '/story/abc-123?from=%2Ft%2Ftopic%3Fcontent_type%3Dgeneral',
    );
    expect(draftHref(7, '/board/topic')).toBe('/draft/7?from=%2Fboard%2Ftopic');
  });

  it('drops a return path it would not follow, rather than passing it on', () => {
    expect(storyHref('abc', 'https://evil.example')).toBe('/story/abc');
    expect(draftHref('abc', '//evil.example')).toBe('/draft/abc');
  });

  it('omits the param entirely when there is nowhere to go back to', () => {
    expect(storyHref('abc')).toBe('/story/abc');
    expect(draftHref('abc', null)).toBe('/draft/abc');
  });
});

describe('returnTarget', () => {
  it('goes back exactly where the reviewer was, scope and all', () => {
    const t = returnTarget('/t/topic?content_type=lead_magnet&status=suggested', 'lead_magnet');
    expect(t.href).toBe('/t/topic?content_type=lead_magnet&status=suggested');
    expect(t.label).toBe('Back to topics');
  });

  it('says "board" only when it is actually going to the board', () => {
    expect(returnTarget('/board/topic', 'general')).toEqual({
      href: '/board/topic',
      label: 'Back to the board',
    });
  });

  it('falls back to the topic TABLE for the kind, which is what the meeting asked for', () => {
    const t = returnTarget(null, 'lead_magnet');
    expect(t.href).toBe('/t/topic?content_type=lead_magnet');
    // The taxonomy's own label, not the raw enum value.
    expect(t.label).toBe('Back to Evergreen');
  });

  it('falls back to the unfiltered topic table when the kind is unknown', () => {
    expect(returnTarget(null, '')).toEqual({ href: '/t/topic', label: 'Back to topics' });
  });

  it('never returns a label that disagrees with its href (bd startsim-uhmk)', () => {
    for (const from of [null, '/t/topic', '/board/topic', 'https://evil.example']) {
      const t = returnTarget(from, 'weekly_brief');
      const saysBoard = t.label.includes('board');
      expect(saysBoard).toBe(t.href.startsWith('/board/'));
    }
  });
});
