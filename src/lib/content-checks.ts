/**
 * OGMC-specific content-validation config + section mapper (bd 768w.16.10.3).
 *
 * The deterministic guardrail checks themselves live in @startsimpli/ui
 * (`runContentChecks`, pure + shared with the n8n judge). What's OGMC-specific
 * is (a) the approved-source allow-list below, and (b) turning the live
 * DocumentEditor sections into the flat `ContentFields` the checker consumes —
 * so validation recomputes over the reviewer's *edited* content, not the stale
 * stored draft. Both live here (app config), not in the shared package.
 */
import type { DocSection } from '@startsimpli/ui/document-editor';
import type { ContentFields } from '@startsimpli/ui';

/**
 * Approved source hosts for OGMC content (Gulf/Saudi business + FDI authorities,
 * major wires, Big-4 advisory). Bare hosts, no `www.` — the checker normalizes.
 * A source URL whose host isn't on this list fails the approved-sources check.
 */
export const OGMC_APPROVED_HOSTS: string[] = [
  'arabianbusiness.com',
  'gulfnews.com',
  'thenationalnews.com',
  'khaleejtimes.com',
  'arabnews.com',
  'saudigazette.com.sa',
  'zawya.com',
  'argaam.com',
  'meed.com',
  'gulf-times.com',
  'vision2030.gov.sa',
  'investsaudi.sa',
  'misa.gov.sa',
  'zatca.gov.sa',
  'spa.gov.sa',
  'moec.gov.ae',
  'tax.gov.ae',
  'u.ae',
  'wam.ae',
  'adio.gov.ae',
  'dubaifdi.gov.ae',
  'ded.ae',
  'det.gov.ae',
  'difc.ae',
  'adgm.com',
  'dmcc.ae',
  'jafza.ae',
  'invest.qa',
  'qfc.qa',
  'bahrainedb.com',
  'investoman.om',
  'fdiintelligence.com',
  'unctad.org',
  'worldbank.org',
  'imf.org',
  'oecd.org',
  'reuters.com',
  'bloomberg.com',
  'ft.com',
  'pwc.com',
  'deloitte.com',
  'ey.com',
  'kpmg.com',
];

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
