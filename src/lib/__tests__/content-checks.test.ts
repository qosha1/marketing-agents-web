import { describe, it, expect } from 'vitest';
import type { DocSection } from '@startsimpli/ui/document-editor';
import { runContentChecks, overallStatus } from '@startsimpli/ui';
import { contentFieldsFromSections, OGMC_APPROVED_HOSTS } from '../content-checks';

function section(key: string, kind: DocSection['kind'], value: unknown): DocSection {
  return { key, label: key, kind, value };
}

describe('contentFieldsFromSections', () => {
  it('maps blog/linkedin/sources + headline + SEO tags/meta_description', () => {
    const sections: DocSection[] = [
      section('blog', 'markdown', '# Body\nsome prose'),
      section('linkedin', 'text', 'Short post [link]'),
      section('seo', 'structured', { tags: 'a, b, c', meta_description: 'A meta line.' }),
      section('sources', 'list', ['https://reuters.com/x', 'https://ft.com/y']),
    ];
    expect(contentFieldsFromSections(sections, 'The Headline')).toEqual({
      blog: '# Body\nsome prose',
      linkedin: 'Short post [link]',
      headline: 'The Headline',
      tags: 'a, b, c',
      metaDescription: 'A meta line.',
      sources: 'https://reuters.com/x\nhttps://ft.com/y',
    });
  });

  it('reads a camelCased SEO meta key (metaDescription) too', () => {
    const sections = [section('seo', 'structured', { metaDescription: 'Camel meta' })];
    expect(contentFieldsFromSections(sections, 'H').metaDescription).toBe('Camel meta');
  });

  it('is blank/empty for absent sections rather than throwing', () => {
    const fields = contentFieldsFromSections([], 'Only a headline');
    expect(fields).toEqual({
      blog: '',
      linkedin: '',
      headline: 'Only a headline',
      tags: '',
      metaDescription: '',
      sources: '',
    });
  });

  it('accepts a plain-string sources section (not just a list)', () => {
    const sections = [section('sources', 'text', 'https://oecd.org/a https://imf.org/b')];
    expect(contentFieldsFromSections(sections, 'H').sources).toBe(
      'https://oecd.org/a https://imf.org/b',
    );
  });
});

describe('OGMC approved-source gating (integration with runContentChecks)', () => {
  const base: DocSection[] = [
    section('blog', 'markdown', 'x '.repeat(450)),
    section('linkedin', 'text', 'post [link] ' + 'y '.repeat(200)),
    section('seo', 'structured', { tags: 'a, b, c, d, e', meta_description: 'm'.repeat(155) }),
  ];

  it('fails when a source host is off the approved list', () => {
    const sections = [...base, section('sources', 'list', ['https://reddit.com/r/x'])];
    const checks = runContentChecks(
      contentFieldsFromSections(sections, 'A headline of about ten words here now'),
      { approvedHosts: OGMC_APPROVED_HOSTS },
    );
    const src = checks.find((c) => c.id === 'approved-sources');
    expect(src?.status).toBe('fail');
    expect(overallStatus(checks)).toBe('fail');
  });

  it('passes the source check when all hosts are approved', () => {
    const sections = [...base, section('sources', 'list', ['https://reuters.com/x', 'https://ft.com/y'])];
    const checks = runContentChecks(
      contentFieldsFromSections(sections, 'A headline of about ten words here now'),
      { approvedHosts: OGMC_APPROVED_HOSTS },
    );
    expect(checks.find((c) => c.id === 'approved-sources')?.status).toBe('pass');
  });
});
