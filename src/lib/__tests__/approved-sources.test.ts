/**
 * The approved-source list comes from the TENANT, not from a constant
 * (bd startsim-768w.18.14), and an EMPTY read is an absence, not a fallback
 * (bd startsim-4ipm).
 *
 * The bug 768w.18.14 fixed: approval was gated on a hardcoded array in app code
 * that had drifted from both n8n's search list and the tenant's own editable
 * `source` table. 59 of 59 drafts with sources cited a blocked host, so NOTHING
 * could be approved. One list, owned by the team, is the fix.
 *
 * The bug 4ipm fixes: that same hardcoded array survived as a "safe" fallback
 * (`fromTenant.length > 0 ? fromTenant : OGMC_APPROVED_HOSTS`), so a failed read
 * silently swapped the BASIS of the check. Measured against prod on 2026-08-20:
 * all 59 drafts-with-sources pass against the tenant's 53 active hosts, and 27
 * of those same 59 FAIL against the hardcoded 43. A fallback that changes 27
 * verdicts with nobody editing anything is not a safe default — it is the drift
 * with an extra step. The read now resolves to one of four states and only
 * `ready` may run the check.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { runContentChecks, overallStatus, type ContentCheck } from '@startsimpli/ui';

import {
  approvedHostsFromSources,
  approvedSourceBasis,
  approvedSourceCheckConfig,
  approvedSourceGap,
  approvedSourceStandIn,
  contentFieldsFromSections,
  type ApprovedSourceBasis,
} from '@/lib/content-checks';

const rec = (data: Record<string, unknown>) => ({ data });

/**
 * A subset of the tenant's live `source` rows (prod, 2026-08-20: 55 rows, 53
 * distinct active hosts). A fixture, deliberately — the point of 768w.18.14 is
 * that the real list lives in the tenant DB and nowhere in this repo.
 */
const LIVE_HOSTS = ['zawya.com', 'gulfnews.com', 'argaam.com', 'reuters.com', 'agbi.com'];

describe('approvedHostsFromSources', () => {
  it('reads the domains off the tenant source records', () => {
    const hosts = approvedHostsFromSources([
      rec({ domain: 'gulfnews.com', tier: 1 }),
      rec({ domain: 'reuters.com', tier: 4 }),
    ]);

    expect(hosts).toEqual(['gulfnews.com', 'reuters.com']);
  });

  it('honours active:false so a retired source stops approving without losing its record', () => {
    const hosts = approvedHostsFromSources([
      rec({ domain: 'gulfnews.com', active: true }),
      rec({ domain: 'retired.example', active: false }),
    ]);

    expect(hosts).toEqual(['gulfnews.com']);
    expect(hosts).not.toContain('retired.example');
  });

  it('treats a missing active flag as active — the live rows do not set it', () => {
    // Most live source rows omit `active`. Defaulting it to false would
    // reproduce the outage this bead exists to fix.
    expect(approvedHostsFromSources([rec({ domain: 'adgm.com' })])).toEqual(['adgm.com']);
  });

  it('normalises whatever the team typed into a bare host', () => {
    const hosts = approvedHostsFromSources([
      rec({ domain: 'https://www.Zawya.com/some/path' }),
      rec({ domain: '  ARABNEWS.com  ' }),
      rec({ domain: 'difc.com:443' }),
    ]);

    expect(hosts).toEqual(['zawya.com', 'arabnews.com', 'difc.com']);
  });

  it('dedupes and skips rows with no usable domain', () => {
    const hosts = approvedHostsFromSources([
      rec({ domain: 'ft.com' }),
      rec({ domain: 'www.ft.com' }),
      rec({ domain: '' }),
      rec({ tier: 2 }),
      rec({ domain: 42 }),
    ]);

    expect(hosts).toEqual(['ft.com']);
  });

  it('is empty for no records, so the caller decides what that means', () => {
    // Deliberately NOT a silent fallback here: the decision belongs at the call
    // site, where the read state (loading / failed / genuinely empty) is known.
    expect(approvedHostsFromSources([])).toEqual([]);
  });
});

describe('approvedSourceBasis — four states, never a substitute list', () => {
  it('is loading while the first read is still in flight', () => {
    expect(approvedSourceBasis({ isPending: true, isError: false })).toEqual({ state: 'loading' });
  });

  it('is failed when the read errored and brought back nothing', () => {
    expect(approvedSourceBasis({ isPending: false, isError: true })).toEqual({ state: 'failed' });
  });

  it('is failed — not loading forever — when nothing is in flight and nothing arrived', () => {
    // A read that is neither running nor answered is a list we do not have. A
    // permanent "loading…" would be the quietest way to hide a broken read.
    expect(approvedSourceBasis({ isPending: false, isError: false })).toEqual({ state: 'failed' });
  });

  it('is ready with the tenant hosts on a successful read', () => {
    const basis = approvedSourceBasis({
      isPending: false,
      isError: false,
      records: [rec({ domain: 'zawya.com' }), rec({ domain: 'gulfnews.com' })],
    });

    expect(basis).toEqual({ state: 'ready', hosts: ['zawya.com', 'gulfnews.com'] });
  });

  it('is undeclared — not failed — when the tenant genuinely declares no sources', () => {
    expect(approvedSourceBasis({ isPending: false, isError: false, records: [] })).toEqual({
      state: 'undeclared',
      recordCount: 0,
    });
  });

  it('is undeclared when every declared source is retired or has no domain', () => {
    // Rows exist, so this is a decision the team made, not a missing read.
    expect(
      approvedSourceBasis({
        isPending: false,
        isError: false,
        records: [rec({ domain: 'retired.example', active: false }), rec({ tier: 2 })],
      }),
    ).toEqual({ state: 'undeclared', recordCount: 2 });
  });

  it('keeps serving the records it already has when a background refetch fails', () => {
    // Slightly stale tenant data is still the tenant table. The sin this bead
    // fixes is substituting a DIFFERENT list, not serving a list a minute old.
    const basis = approvedSourceBasis({
      isPending: false,
      isError: true,
      records: [rec({ domain: 'zawya.com' })],
    });

    expect(basis).toEqual({ state: 'ready', hosts: ['zawya.com'] });
  });

  it('reports failed, not undeclared, when the error left no usable hosts', () => {
    // "The read broke" explains an empty result better than "the team declared
    // nothing" does, and the two must not read the same to a reviewer.
    expect(
      approvedSourceBasis({ isPending: false, isError: true, records: [] }),
    ).toEqual({ state: 'failed' });
  });
});

describe('approvedSourceCheckConfig — an unknown basis omits the key entirely', () => {
  it('passes the tenant hosts when the basis is ready', () => {
    const config = approvedSourceCheckConfig({ state: 'ready', hosts: LIVE_HOSTS });
    expect(config).toEqual({ approvedHosts: LIVE_HOSTS });
  });

  it.each<[string, ApprovedSourceBasis]>([
    ['loading', { state: 'loading' }],
    ['failed', { state: 'failed' }],
    ['undeclared', { state: 'undeclared', recordCount: 0 }],
  ])('omits approvedHosts entirely when the basis is %s', (_name, basis) => {
    const config = approvedSourceCheckConfig(basis);

    // NOT `{ approvedHosts: [] }`. runContentChecks runs the check whenever the
    // KEY is present (`if (approvedHosts !== undefined)`), so an empty array
    // fails every host on earth — the opposite drift, and just as wrong.
    expect('approvedHosts' in config).toBe(false);
    expect(config).toEqual({});
  });
});

describe('approvedSourceGap — three unknown states, three different sentences', () => {
  it('is null when the basis is ready — there is nothing to disclose', () => {
    expect(approvedSourceGap({ state: 'ready', hosts: LIVE_HOSTS })).toBeNull();
  });

  it('says the list did not load when the read failed, and offers a retry', () => {
    const gap = approvedSourceGap({ state: 'failed' });
    expect(gap?.title).toMatch(/did not load/i);
    expect(gap?.retryable).toBe(true);
  });

  it('says the tenant declares none when the table is empty, and points at the screen', () => {
    const gap = approvedSourceGap({ state: 'undeclared', recordCount: 0 });
    expect(gap?.title).toMatch(/no approved sources/i);
    expect(gap?.retryable).toBe(false);
  });

  it('distinguishes "all retired" from "none declared" — the fix differs', () => {
    const none = approvedSourceGap({ state: 'undeclared', recordCount: 0 });
    const retired = approvedSourceGap({ state: 'undeclared', recordCount: 7 });
    expect(retired?.description).not.toBe(none?.description);
    expect(retired?.description).toMatch(/7/);
  });

  it('renders loading, undeclared and failed as three different states', () => {
    // The whole point of the bead: they are not the same event and must not
    // read the same. Compare every user-visible string, not just the title.
    const gaps = [
      approvedSourceGap({ state: 'loading' }),
      approvedSourceGap({ state: 'undeclared', recordCount: 0 }),
      approvedSourceGap({ state: 'failed' }),
    ];
    const rendered = gaps.map((g) => `${g?.title}|${g?.description}|${g?.detail}|${g?.gateHint}`);

    expect(new Set(rendered).size).toBe(3);
    expect(gaps.every((g) => g !== null)).toBe(true);
  });

  it('gives the decision bar something truer than "Ready to accept"', () => {
    // An unchecked basis does not BLOCK Accept (a blip must not stall the queue),
    // so the bar the reviewer clicks has to carry the disclosure instead.
    expect(approvedSourceGap({ state: 'failed' })?.gateHint).toMatch(/unchecked/i);
    expect(approvedSourceGap({ state: 'undeclared', recordCount: 0 })?.gateHint).toMatch(
      /unchecked/i,
    );
    expect(approvedSourceGap({ state: 'loading' })?.gateHint).toMatch(/not checked yet|loading/i);
  });

  it('never claims a verdict about the draft', () => {
    for (const basis of [
      { state: 'loading' } as const,
      { state: 'failed' } as const,
      { state: 'undeclared', recordCount: 0 } as const,
    ]) {
      const gap = approvedSourceGap(basis);
      expect(`${gap?.title} ${gap?.description}`).not.toMatch(/unapproved|not approved|blocked/i);
    }
  });
});

describe('approvedSourceStandIn — the checklist slot is held, never silently dropped', () => {
  it('is null when the basis is ready (the real check runs instead)', () => {
    expect(approvedSourceStandIn({ state: 'ready', hosts: LIVE_HOSTS })).toBeNull();
  });

  it('warns — it does not fail the draft for a broken read', () => {
    const check = approvedSourceStandIn({ state: 'failed' });

    expect(check?.id).toBe('approved-sources');
    expect(check?.label).toBe('Approved sources');
    // 'fail' would block the whole review queue on a network blip — the same
    // outage 768w.18.14 fixed, arrived at from the other direction.
    expect(check?.status).toBe('warn');
    expect(check?.detail).toMatch(/not checked/i);
  });

  it('sends the reviewer to the sources channel, where the absence is explained', () => {
    expect(approvedSourceStandIn({ state: 'failed' })?.locations).toEqual([{ field: 'sources' }]);
  });
});

describe('the check, end to end', () => {
  const sourced = (urls: string[]) =>
    contentFieldsFromSections(
      [{ key: 'sources', label: 'Sources', kind: 'list', value: urls }],
      'A headline of exactly eight words here now',
    );

  const withStandIn = (basis: ApprovedSourceBasis, urls: string[]): ContentCheck[] => {
    const checks = runContentChecks(sourced(urls), approvedSourceCheckConfig(basis));
    const standIn = approvedSourceStandIn(basis);
    return standIn ? [...checks, standIn] : checks;
  };

  const approvedSources = (checks: ContentCheck[]) => checks.filter((c) => c.id === 'approved-sources');

  it('passes a draft citing tenant-approved hosts — the live happy path is unchanged', () => {
    // Prod 2026-08-20: 59 of 59 drafts-with-sources pass against the tenant list.
    const checks = withStandIn({ state: 'ready', hosts: LIVE_HOSTS }, [
      'https://www.zawya.com/en/story-a',
      'https://gulfnews.com/business/story-b',
    ]);

    expect(approvedSources(checks)).toHaveLength(1);
    expect(approvedSources(checks)[0]?.status).toBe('pass');
  });

  it('still fails a genuinely unapproved host when the basis is ready', () => {
    const checks = withStandIn({ state: 'ready', hosts: LIVE_HOSTS }, [
      'https://randomblog.example/x',
    ]);

    expect(approvedSources(checks)[0]?.status).toBe('fail');
    expect(approvedSources(checks)[0]?.detail).toMatch(/randomblog\.example/);
  });

  it('refuses to compute against anything else when the read failed', () => {
    const urls = ['https://www.zawya.com/en/story-a'];
    const failed = withStandIn({ state: 'failed' }, urls);

    // Exactly one row, and it is the stand-in: the real check did not run.
    expect(approvedSources(failed)).toHaveLength(1);
    expect(approvedSources(failed)[0]?.status).toBe('warn');
    expect(approvedSources(failed)[0]?.detail).toMatch(/not checked/i);

    // The row count matches the ready path, so "7/8" never quietly becomes "7/7".
    const ready = withStandIn({ state: 'ready', hosts: LIVE_HOSTS }, urls);
    expect(failed).toHaveLength(ready.length);
  });

  it('does not flip a draft to blocked because the list did not load', () => {
    // The regression this bead names: with the old fallback, 27 of the 59 live
    // drafts changed verdict on an empty read. A host approved by the tenant
    // must never come back FAILED just because the read broke.
    const urls = ['https://agbi.com/story', 'https://www.zawya.com/en/story-a'];

    expect(overallStatus(approvedSources(withStandIn({ state: 'ready', hosts: LIVE_HOSTS }, urls)))).toBe('pass');
    expect(overallStatus(approvedSources(withStandIn({ state: 'failed' }, urls)))).toBe('warn');
    expect(overallStatus(approvedSources(withStandIn({ state: 'loading' }, urls)))).toBe('warn');
    expect(
      overallStatus(approvedSources(withStandIn({ state: 'undeclared', recordCount: 0 }, urls))),
    ).toBe('warn');
  });
});

describe('no second list survives in this repo', () => {
  it('exports no hardcoded host list', async () => {
    const mod = await import('@/lib/content-checks');
    expect(Object.keys(mod)).not.toContain('OGMC_APPROVED_HOSTS');
  });

  it('holds no domain literals at all — the tenant table is the only list', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/content-checks.ts'),
      'utf8',
    );
    // Quoted `something.tld` literals. Module specifiers ('@startsimpli/ui')
    // carry no dot, so anything this finds is a host someone re-hardcoded.
    const domains = src.match(/'[a-z0-9-]+(?:\.[a-z0-9-]+)+'/g) ?? [];

    expect(domains).toEqual([]);
  });
});
