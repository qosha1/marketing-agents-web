/**
 * Fields the draft history never prints (bd startsim-m7fdm.27, element e32).
 *
 * The revision trail records every write, including the pipeline's own
 * bookkeeping. A reviewer reads who changed the title, the blog, the LinkedIn
 * post, the SEO fields and the sources; run ids, trigger names and judge output
 * are plumbing. Nothing is deleted from the trail: this only decides what the
 * panel shows.
 */
import { isSystemAttr } from '@/components/record-columns';

/** Pipeline output that is not an underscore key but is just as internal. */
const MACHINE_FIELDS = new Set(['auto_checks', 'judge_verdict', 'scope_path', 'source_texts_stats']);

export function isHistoryNoise(field: string): boolean {
  return isSystemAttr(field) || MACHINE_FIELDS.has(field);
}
