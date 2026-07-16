import { describe, it, expect } from 'vitest';
import { runContentChecks, type ContentCheck } from '@startsimpli/ui';
import type { DocSection } from '@startsimpli/ui/document-editor';
import { contentFieldsFromSections, OGMC_APPROVED_HOSTS } from '../content-checks';
import {
  FIELD_CHANNEL,
  channelForField,
  findStopIndex,
  isChannelId,
  issueStops,
  nextStopIndex,
  prevStopIndex,
  stopIndexForCheck,
} from '../issue-jump';

/** A non-passing check with locations, shaped like runContentChecks emits them. */
function check(id: string, locations: ContentCheck['locations'], status: ContentCheck['status'] = 'fail'): ContentCheck {
  return { id, label: id, status, locations };
}

describe('FIELD_CHANNEL', () => {
  it('maps every ContentFields key to a channel', () => {
    expect(FIELD_CHANNEL).toEqual({
      blog: 'brief',
      headline: 'brief',
      linkedin: 'linkedin',
      metaDescription: 'seo',
      tags: 'seo',
      sources: 'sources',
    });
  });

  it('resolves a known field and returns undefined for an unmapped one', () => {
    expect(channelForField('metaDescription')).toBe('seo');
    expect(channelForField('somethingNew')).toBeUndefined();
  });

  it('recognizes channel ids (guards the ?channel= seed)', () => {
    expect(isChannelId('sources')).toBe(true);
    expect(isChannelId('nope')).toBe(false);
    expect(isChannelId(null)).toBe(false);
  });
});

describe('issueStops', () => {
  it('skips passing checks — a green check has nowhere to jump to', () => {
    const checks: ContentCheck[] = [
      { id: 'blog-words', label: 'Blog word count', status: 'pass' },
      check('no-hype', [{ field: 'blog', matches: ['revolutionary'] }]),
    ];
    expect(issueStops(checks).map((s) => s.checkId)).toEqual(['no-hype']);
  });

  it('yields one stop per location so a multi-field check reaches each', () => {
    const stops = issueStops([
      check('no-hype', [
        { field: 'blog', matches: ['revolutionary'] },
        { field: 'linkedin', matches: ['game-changing', 'unmatched'] },
      ]),
    ]);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({ field: 'blog', channel: 'brief', matches: ['revolutionary'] });
    expect(stops[1]).toMatchObject({
      field: 'linkedin',
      channel: 'linkedin',
      matches: ['game-changing', 'unmatched'],
    });
  });

  it('keeps a location with no matches — the field itself is the finding', () => {
    const stops = issueStops([check('blog-words', [{ field: 'blog' }], 'warn')]);
    expect(stops).toHaveLength(1);
    expect(stops[0].matches).toEqual([]);
    expect(stops[0].channel).toBe('brief');
  });

  it('drops a location whose field has no channel rather than offering a dead jump', () => {
    const stops = issueStops([
      { id: 'future-check', label: 'Future', status: 'fail', locations: [{ field: 'podcast' as never }] },
    ]);
    expect(stops).toEqual([]);
  });

  it('tolerates a non-passing check with no locations at all', () => {
    expect(issueStops([{ id: 'odd', label: 'Odd', status: 'fail' }])).toEqual([]);
  });
});

describe('findStopIndex', () => {
  const stops = issueStops([
    check('no-hype', [{ field: 'blog', matches: ['x'] }, { field: 'linkedin', matches: ['x'] }]),
    check('approved-sources', [{ field: 'sources', matches: ['https://reddit.com/r/a'] }]),
  ]);

  it('re-resolves a stop by identity across a recompute', () => {
    expect(findStopIndex(stops, { checkId: 'no-hype', field: 'linkedin' })).toBe(1);
    expect(findStopIndex(stops, { checkId: 'approved-sources', field: 'sources' })).toBe(2);
  });

  it('returns -1 once the issue is fixed (so the highlight clears, not drifts)', () => {
    expect(findStopIndex(stops, { checkId: 'no-hype', field: 'headline' })).toBe(-1);
    expect(findStopIndex(stops, null)).toBe(-1);
  });
});

describe('next/prev stop cycling', () => {
  it('starts at the first going forward and the last going back', () => {
    expect(nextStopIndex(-1, 3)).toBe(0);
    expect(prevStopIndex(-1, 3)).toBe(2);
  });

  it('wraps at both ends', () => {
    expect(nextStopIndex(2, 3)).toBe(0);
    expect(prevStopIndex(0, 3)).toBe(2);
  });

  it('advances one at a time', () => {
    expect(nextStopIndex(0, 3)).toBe(1);
    expect(prevStopIndex(2, 3)).toBe(1);
  });

  it('is a no-op with no issues', () => {
    expect(nextStopIndex(-1, 0)).toBe(-1);
    expect(prevStopIndex(-1, 0)).toBe(-1);
  });
});

/**
 * The jump rests on a shape the SHARED checker emits, not on one we control — so
 * pin it against the real runContentChecks rather than only against hand-built
 * fixtures. This is what fails if a future @startsimpli/ui drops `locations` or
 * stops reporting URLs the way the Sources rows are keyed.
 */
describe('against the real runContentChecks', () => {
  const sections: DocSection[] = [
    {
      key: 'blog',
      label: 'Blog',
      kind: 'markdown',
      value: 'This revolutionary shift is unmatched. ' + 'word '.repeat(50),
    },
    { key: 'linkedin', label: 'LinkedIn', kind: 'text', value: 'A game-changing update. [link]' },
    { key: 'seo', label: 'SEO', kind: 'structured', value: { tags: 'a, b', meta_description: 'short' } },
    {
      key: 'sources',
      label: 'Sources',
      kind: 'list',
      value: ['https://reuters.com/ok', 'https://www.reddit.com/r/gulf/comments/x'],
    },
  ];
  const stops = issueStops(
    runContentChecks(contentFieldsFromSections(sections, 'A headline'), {
      approvedHosts: OGMC_APPROVED_HOSTS,
    }),
  );

  it('routes a hype word to the channel of the field it is actually in', () => {
    const hype = stops.filter((s) => s.checkId === 'no-hype');
    expect(hype.map((s) => [s.channel, s.matches])).toEqual([
      ['brief', ['revolutionary', 'unmatched']],
      ['linkedin', ['game-changing']],
    ]);
  });

  it('flags the unapproved source as a whole URL — how the Sources rows are keyed', () => {
    const sourceStop = stops.find((s) => s.checkId === 'approved-sources');
    expect(sourceStop?.channel).toBe('sources');
    // SourcesTool marks a row via `flagged.includes(source.url)`, so the match must
    // come back as the full URL, not a bare host.
    expect(sourceStop?.matches).toEqual(['https://www.reddit.com/r/gulf/comments/x']);
  });

  it('gives every non-passing check somewhere to go', () => {
    // No failing check may be a dead end — that is the whole point of P3.
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((s) => !!s.channel)).toBe(true);
  });
});

describe('stopIndexForCheck', () => {
  const stops = issueStops([
    check('blog-words', [{ field: 'blog' }], 'warn'),
    check('no-hype', [{ field: 'blog', matches: ['x'] }, { field: 'linkedin', matches: ['x'] }]),
  ]);

  it('goes to the check‘s first location when arriving from elsewhere', () => {
    expect(stopIndexForCheck(stops, 'no-hype', -1)).toBe(1);
    expect(stopIndexForCheck(stops, 'no-hype', 0)).toBe(1);
  });

  it('advances to the next location when re-activated while already there', () => {
    expect(stopIndexForCheck(stops, 'no-hype', 1)).toBe(2);
  });

  it('wraps back to the first location of the same check', () => {
    expect(stopIndexForCheck(stops, 'no-hype', 2)).toBe(1);
  });

  it('stays put for a single-location check', () => {
    expect(stopIndexForCheck(stops, 'blog-words', 0)).toBe(0);
  });

  it('returns -1 for a check with no jumpable location', () => {
    expect(stopIndexForCheck(stops, 'meta-length', -1)).toBe(-1);
  });
});
