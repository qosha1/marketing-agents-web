/**
 * The tenant's approved-source list (bd startsim-768w.18.14, bd startsim-4ipm).
 *
 * The Sources tab badges each cited host approved or unverified against the
 * tenant's own `source` records. This used to also feed the deterministic
 * checks that gated Approve; that gate went with the Checks section and the
 * draft decision (bd startsim-m7fdm.25), so only the list and its absence are
 * left.
 *
 * There is no allow-list in this file, and there must never be one again: see
 * the block comment on {@link approvedHostsFromSources} (bd 768w.18.14) and on
 * {@link approvedSourceBasis} (bd startsim-4ipm).
 */

// ---------------------------------------------------------------------------
//  the approved-source list, from the TENANT (bd startsim-768w.18.14)
// ---------------------------------------------------------------------------

/** The entity type whose records ARE the approved-source list. */
export const SOURCE_TYPE = 'source';

/**
 * The approved hosts, read off the tenant's own `source` records.
 *
 * WHY THIS EXISTS AT ALL. Approval was hard-gated on a hardcoded whitelist in
 * this file that had drifted from the two other lists describing the same
 * thing: n8n's Tavily `include_domains` (23 domains) and the tenant's `source`
 * table (23 rows, editable by the team in the Approved Source screen). The
 * overlap between the hardcoded list and n8n's was NINE, so 14 of the domains
 * the pipeline is told to source FROM were domains the reviewer then blocked —
 * and 59 of 59 drafts with sources cited at least one of them. Nothing could be
 * approved.
 *
 * The `source` table is the only one of the three the team can edit, so it is
 * the one that decides. Editing Approved Source now changes what passes review,
 * and the drift cannot come back, because there is one list.
 *
 * `active: false` is honoured — a retired source stops being approved without
 * anyone deleting its record and losing its history.
 */
export function approvedHostsFromSources(records: readonly SourceRecordish[]): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const data = (record?.data ?? {}) as Record<string, unknown>;
    if (data.active === false) continue;
    const host = normalizeHost(data.domain);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

/** The shape this needs off an entity record — deliberately structural, not an import. */
export interface SourceRecordish {
  data?: unknown;
}

// ---------------------------------------------------------------------------
//  an empty read is an ABSENCE, not a fallback (bd startsim-4ipm)
// ---------------------------------------------------------------------------

/** What the page knows about the tenant `source` read at render time. */
export interface ApprovedSourceRead {
  /** The records the read has produced, or undefined before its first success. */
  records?: readonly SourceRecordish[];
  /** The first read is still in flight. */
  isPending: boolean;
  /** The read errored. May still carry `records` from an earlier success. */
  isError: boolean;
}

/**
 * What the approved-sources check may be computed against — and, in three cases
 * out of four, that it may not be computed at all.
 *
 * - `ready`      — the tenant's list, the only basis the check may ever use.
 * - `loading`    — nobody has answered yet. Not an absence; a not-yet.
 * - `undeclared` — the read succeeded and the tenant declares no usable source.
 * - `failed`     — we asked and did not get an answer.
 *
 * The last three are separate STATES, not one "empty", because the fix for each
 * differs: wait, edit the Approved Source screen, retry.
 */
export type ApprovedSourceBasis =
  | { state: 'ready'; hosts: string[] }
  | { state: 'loading' }
  | { state: 'undeclared'; recordCount: number }
  | { state: 'failed' };

/**
 * Resolve the read into a basis. Pure.
 *
 * WHY THIS EXISTS. This call site used to end in
 *
 *     return fromTenant.length > 0 ? fromTenant : OGMC_APPROVED_HOSTS;
 *
 * so a network blip, an empty page or an RLS hiccup silently swapped the BASIS
 * of an approval gate from the team-editable `source` table to a 43-host array
 * compiled into the bundle. Measured against prod on 2026-08-20: all 59
 * drafts-with-sources pass against the tenant's 53 active hosts, and 27 of those
 * same 59 FAIL against the hardcoded 43. Approvability changed with nobody
 * editing anything — the drift 768w.18.14 was filed to remove, reintroduced as
 * a "safe" default.
 *
 * A basis we do not have is not a different basis. It is an absence, and the
 * caller says so instead of computing.
 *
 * A failed BACKGROUND refetch that still holds records stays `ready`: slightly
 * stale tenant data is still the tenant's list, and the thing being forbidden
 * here is substituting a *different* list, not serving one a minute old.
 */
export function approvedSourceBasis(read: ApprovedSourceRead): ApprovedSourceBasis {
  const { records, isPending, isError } = read;
  // Nothing in hand: still waiting is a not-yet; anything else — an error, or a
  // read that is neither running nor answered — is a list we do not have.
  if (records === undefined) {
    return !isError && isPending ? { state: 'loading' } : { state: 'failed' };
  }

  const hosts = approvedHostsFromSources(records);
  if (hosts.length > 0) return { state: 'ready', hosts };

  // Nothing usable came back. An error explains that better than a claim about
  // what the team declared, and the two must not read the same to a reviewer.
  return isError ? { state: 'failed' } : { state: 'undeclared', recordCount: records.length };
}

/** What to say, and whether re-reading could fix it, when there is no list. */
export interface ApprovedSourceGap {
  /** Heading for the Absence the sources channel renders. */
  title: string;
  /** One line of what — never a number standing in for a verdict. */
  description: string;
  /** Whether asking again is the fix (an error) or not (a genuine empty). */
  retryable: boolean;
}

/**
 * The disclosure for a basis the Sources tab cannot badge against — null when it can.
 *
 * Three unknown states, three different sentences. None of them says anything
 * about the DRAFT: not knowing whether a source is approved is a fact about the
 * list, and rendering it as a verdict on the content is the same category error
 * the fallback made.
 */
export function approvedSourceGap(basis: ApprovedSourceBasis): ApprovedSourceGap | null {
  switch (basis.state) {
    case 'ready':
      return null;
    case 'loading':
      return {
        title: 'Reading the approved-source list…',
        description: 'Sources are badged against it as soon as it arrives.',
        retryable: false,
      };
    case 'undeclared':
      return {
        title: 'No approved sources are declared',
        description:
          basis.recordCount > 0
            ? `All ${basis.recordCount} declared sources are retired or have no domain, so there is nothing to badge sources against. Reactivate one in Approved Source.`
            : 'This tenant has not declared any, so there is nothing to badge sources against. Add them in Approved Source.',
        retryable: false,
      };
    case 'failed':
      return {
        title: 'The approved-source list did not load',
        description:
          'Sources are badged against the tenant’s Approved Source records, and that read failed — so nothing is badged rather than badged against some other list.',
        retryable: true,
      };
  }
}

/** A bare host: lowercased, no scheme, no www., no path, no port. */
function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') return '';
  let host = value.trim().toLowerCase();
  if (!host) return '';
  host = host.replace(/^[a-z]+:\/\//, '');
  host = host.split('/')[0] ?? '';
  host = host.split('?')[0] ?? '';
  host = host.split(':')[0] ?? '';
  host = host.replace(/^www\./, '');
  return host;
}
