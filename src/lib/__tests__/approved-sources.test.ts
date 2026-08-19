/**
 * The approved-source list comes from the TENANT, not from a constant
 * (bd startsim-768w.18.14).
 *
 * The bug this pins down: approval was gated on a hardcoded array in app code
 * that had drifted from both n8n's search list and the tenant's own editable
 * `source` table. 59 of 59 drafts with sources cited a blocked host, so NOTHING
 * could be approved. One list, owned by the team, is the fix.
 */
import { describe, expect, it } from 'vitest';

import { approvedHostsFromSources } from '@/lib/content-checks';

const rec = (data: Record<string, unknown>) => ({ data });

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
    // Every one of the 23 live source rows omits `active`. Defaulting it to
    // false would reproduce the outage this bead exists to fix.
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
    // Deliberately NOT a silent fallback here: an empty list would block every
    // draft, so the decision belongs at the call site where loading state is known.
    expect(approvedHostsFromSources([])).toEqual([]);
  });
});
