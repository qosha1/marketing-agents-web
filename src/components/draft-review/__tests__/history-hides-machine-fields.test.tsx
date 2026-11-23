/**
 * The history never prints the pipeline's own keys (bd startsim-m7fdm.27, e32:
 * "today it also shows internal field names like _run_id"). Quinn reads who
 * changed the title, blog, LinkedIn post, SEO and sources, not run plumbing.
 */
import { describe, expect, it } from 'vitest';

import { isHistoryNoise } from '@/lib/history-fields';

describe('isHistoryNoise', () => {
  it.each(['_run_id', '_copied_from', '_trigger', 'auto_checks', 'judge_verdict', 'scope_path', 'source_texts_stats'])(
    'hides %s',
    (f) => expect(isHistoryNoise(f)).toBe(true),
  );
  it.each(['title', 'name', 'blog', 'linkedin', 'seo', 'sources', 'status', 'candidate_index'])('keeps %s', (f) =>
    expect(isHistoryNoise(f)).toBe(false),
  );
});
