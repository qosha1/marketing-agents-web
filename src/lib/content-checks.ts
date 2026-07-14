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
