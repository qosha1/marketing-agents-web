/**
 * OGMC-specific content-validation config + section mapper (bd 768w.16.10.3).
 *
 * The deterministic guardrail checks themselves live in @startsimpli/ui
 * (`runContentChecks`, pure + shared with the n8n judge). What's OGMC-specific
 * is (a) resolving the approved-source allow-list out of the TENANT's own
 * `source` records, and (b) turning the live DocumentEditor sections into the
 * flat `ContentFields` the checker consumes — so validation recomputes over the
 * reviewer's *edited* content, not the stale stored draft. Both live here (app
 * config), not in the shared package.
 *
 * There is no allow-list in this file, and there must never be one again: see
 * the block comment on {@link approvedHostsFromSources} (bd 768w.18.14) and on
 * {@link approvedSourceBasis} (bd startsim-4ipm).
 */
import type { DocSection } from '@startsimpli/ui/document-editor';
import type { CheckPolicySet, ContentCheck, ContentFields } from '@startsimpli/ui';

/** The current value of a section by key, or undefined when absent. */
function sectionValue(sections: DocSection[], key: string): unknown {
  return sections.find((s) => s.key === key)?.value;
}

/** snake_case → camelCase, matching the tenant client's key transform. */
function toCamelKey(name: string): string {
  return name.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * camelCase-aware read of a string field out of a structured section's Record
 * value (the SEO section stores e.g. `meta_description`, which the tenant client
 * may camelCase to `metaDescription`). '' when absent.
 */
function readField(obj: Record<string, unknown> | undefined, name: string): string {
  if (!obj) return '';
  const v = obj[toCamelKey(name)] ?? obj[name];
  return v == null ? '' : String(v);
}

/**
 * Map the LIVE editor sections (+ the draft headline) to the flat
 * {@link ContentFields} `runContentChecks` consumes. Pure — so the checks
 * recompute over the reviewer's current edits, not the stored draft. The `list`
 * sources section is newline-joined into the flat sources string the URL scan
 * expects; the structured SEO section yields `tags` + `metaDescription`.
 */
export function contentFieldsFromSections(
  sections: DocSection[],
  headline: string,
): ContentFields {
  const blog = String(sectionValue(sections, 'blog') ?? '');
  const linkedin = String(sectionValue(sections, 'linkedin') ?? '');

  const seoRaw = sectionValue(sections, 'seo');
  const seo =
    seoRaw && typeof seoRaw === 'object' && !Array.isArray(seoRaw)
      ? (seoRaw as Record<string, unknown>)
      : undefined;

  const sourcesRaw = sectionValue(sections, 'sources');
  const sources = Array.isArray(sourcesRaw)
    ? sourcesRaw.map((s) => String(s)).join('\n')
    : String(sourcesRaw ?? '');

  return {
    blog,
    linkedin,
    headline,
    tags: readField(seo, 'tags'),
    metaDescription: readField(seo, 'meta_description'),
    sources,
  };
}

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

/**
 * The `runContentChecks` config fragment for the approved-source check.
 *
 * Omits the key entirely unless the basis is `ready`. NEVER `approvedHosts: []`:
 * the checker runs the check whenever the key is PRESENT
 * (`if (approvedHosts !== undefined)`), so an empty array fails every host on
 * earth — the opposite drift, and just as wrong. An absent key skips the check,
 * which is what "we cannot compute this" actually means.
 */
export function approvedSourceCheckConfig(
  basis: ApprovedSourceBasis,
): { approvedHosts?: string[] } {
  return basis.state === 'ready' ? { approvedHosts: basis.hosts } : {};
}

/** What to say, and whether re-reading could fix it, when the check cannot run. */
export interface ApprovedSourceGap {
  /** Heading for the Absence the sources channel renders. */
  title: string;
  /** One line of what — never a number standing in for a verdict. */
  description: string;
  /** The checklist row's detail. */
  detail: string;
  /**
   * What the decision bar says where the reviewer actually clicks. An unchecked
   * basis does not block Accept, so the bar must not read "Ready to accept" over
   * a guardrail that never ran.
   */
  gateHint: string;
  /** Whether asking again is the fix (an error) or not (a genuine empty). */
  retryable: boolean;
}

/**
 * The disclosure for a basis the check cannot use — null when it can.
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
        description: 'Citations are checked against it as soon as it arrives.',
        detail: 'not checked yet — still reading the approved-source list',
        gateHint: 'Approved sources are not checked yet — the list is still loading',
        retryable: false,
      };
    case 'undeclared':
      return {
        title: 'No approved sources are declared',
        description:
          basis.recordCount > 0
            ? `All ${basis.recordCount} declared sources are retired or have no domain, so there is nothing to check citations against. Reactivate one in Approved Source.`
            : 'This tenant has not declared any, so there is nothing to check citations against. Add them in Approved Source.',
        detail: 'not checked — the tenant declares no approved sources',
        gateHint: 'Accepting unchecked: the tenant declares no approved sources',
        retryable: false,
      };
    case 'failed':
      return {
        title: 'The approved-source list did not load',
        description:
          'Citations are checked against the tenant’s Approved Source records, and that read failed — so this check was skipped rather than run against some other list.',
        detail: 'not checked — the approved-source list did not load',
        gateHint: 'Accepting unchecked: the approved-source list did not load',
        retryable: true,
      };
  }
}

/**
 * A stand-in row for the checklist while the check cannot run — null when it can.
 *
 * It keeps the approved-sources SLOT occupied so "7 of 8" never quietly becomes
 * "7 of 7": a check that silently disappears reads as a check that passed.
 *
 * `warn`, deliberately, not `fail`. A `fail` would block the entire review queue
 * on a transient read error — the 59-of-59 outage 768w.18.14 fixed, reached from
 * the other direction — and would state a verdict about a draft we have not
 * checked. `warn` is what the shared checker itself emits when it cannot run a
 * check meaningfully, and it surfaces in the rail's issue list without inventing
 * a gate.
 */
export function approvedSourceStandIn(basis: ApprovedSourceBasis): ContentCheck | null {
  const gap = approvedSourceGap(basis);
  if (!gap) return null;
  return {
    id: 'approved-sources',
    label: 'Approved sources',
    status: 'warn',
    detail: gap.detail,
    // No `matches` — the whole channel is the answer, and the Absence card there
    // explains it. A jump still opens the right place to read about it.
    locations: [{ field: 'sources' }],
  };
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

/**
 * OGMC's standing check policy: which checks run and against what thresholds,
 * per `content_type` and per language (bd startsim-wncr6).
 *
 * THIS IS THE ONLY PLACE OGMC'S EDITORIAL NUMBERS BELONG. `@startsimpli/ui`
 * ships to every tenant and deliberately contains no content-type value, locale
 * or band of ours — `resolveCheckPolicy` is the mechanism, this is the policy.
 *
 * WHY `weekly_brief` RESTATES THE PACKAGE DEFAULT rather than inheriting it:
 * 400–500 is OGMC's number, given by the team on 2026-08-25 ("we defined with
 * four to five hundred words"). That it currently coincides with
 * `DEFAULTS.blogWords` is a coincidence, and one a future package release is
 * free to break. Declaring it here means our band changes when OGMC changes it,
 * not when the package does.
 *
 * WHY THE OTHER TWO TYPES ARE ABSENT: we do not have their numbers. Jurga
 * described Evergreen as "much more in-depth, much bigger scope" and General as
 * "not urgent, not recent, but also not in-depth… much simpler" — real
 * distinctions, but not word counts, and inventing them would put a band in
 * front of reviewers that no one agreed to. Absent means they inherit the
 * package defaults, which is honest and never means "no check". The ask is bd
 * startsim-ozpjw.3, which carries the Chinese bands (bd startsim-wn2p.29) in the
 * same conversation because it is one editorial question, not two.
 *
 * ⚠️ EVERGREEN'S STORED VALUE IS `lead_magnet`, NOT `evergreen` — see
 * src/lib/content.ts for why it must stay that way. A rule keyed on 'evergreen'
 * matches nothing, silently, and drops every evergreen draft back to the brief
 * band: exactly the bug this policy exists to fix.
 */
export const OGMC_CHECK_POLICY: CheckPolicySet = [
  { contentType: 'weekly_brief', policy: { blogWords: [400, 500] } },
];
