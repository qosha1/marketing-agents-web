/**
 * The authed reader for one record's revision trail (bd startsim-o1qib; panel bd
 * startsim-g4rwo; adopted here by bd startsim-j19hf).
 *
 * `GET /api/v1/entities/<id>/revisions/` — append-only, newest first, server-side
 * paginated. Injected into `@startsimpli/ui/history`'s `RecordHistoryPanel` and
 * into `useConditionalSave`, which is what keeps @startsimpli/api out of
 * packages/ui and this wrapper under thirty lines of actual code.
 *
 * ── THIS DOES NOT GO THROUGH `@/lib/api`, AND THAT IS THE WHOLE FILE ────────
 *
 * The shared client camelCases every response key RECURSIVELY and has no
 * preserve list (`packages/api/src/utils/case-transform.ts`). The transform
 * recurses INTO `metadata.changed`, whose keys are not an API contract — they
 * are THE TENANT'S OWN DECLARED ATTRIBUTE NAMES. So `judge_verdict` would reach
 * the panel as `judgeVerdict` and `candidate_index` as `candidateIndex`, and
 * there is no safe inverse: `snake_to_camel` is not injective (lib/foundry-api.
 * ts's own wire-safety section measures it — `source_1` becomes `source1` and
 * "cannot be turned back"), so guessing one would print a field name this tenant
 * never declared. The panel renders field names EXACTLY as received and
 * deliberately never re-cases them.
 *
 * This repo has already had one camelisation corruption incident over precisely
 * that transform. So the trail is read with a plain `fetch` and the raw bearer,
 * and the declared spellings reach the reader intact. The panel reads EITHER
 * spelling for its OWN keys (`actor_kind` / `actorKind`), so raw snake_case is
 * exactly what it expects.
 *
 * ── TWO SMALLER THINGS THAT WOULD BITE ──────────────────────────────────────
 *
 * NO TRAILING SLASH ON THE PATH. The `next.config.ts` rewrite APPENDS one to
 * whatever it is given, so a path written with its own slash arrives at Django
 * doubled and DRF does not route it. Same convention as every endpoint string in
 * lib/foundry-api.ts.
 *
 * A 404 IS NOT AN EMPTY TRAIL. The route is nested and resolves its parent
 * through the gated queryset, so 404 means "you may not read the PARENT record".
 * The status is attached to the thrown error because that is how the panel tells
 * the two apart — it renders "History is not available to you", never an empty
 * history (and `useConditionalSave` maps the same 404 to `identityGap:
 * 'forbidden'` rather than to "nobody changed it").
 */
import type { RevisionClient, RevisionPage, RevisionQuery } from '@startsimpli/ui/history';

import { getRegisteredToken } from '@/infrastructure/auth';
import { formatBearer } from '@/lib/bearer';

/** An error that carries the HTTP status, because the panel branches on 404. */
class RevisionsError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`revisions responded ${status}`);
    this.name = 'RevisionsError';
    this.status = status;
  }
}

/** The injected reader for ONE record's trail. */
export function revisionClient(id: number | string): RevisionClient {
  return {
    list: async ({ page = 1, pageSize = 50 }: RevisionQuery): Promise<RevisionPage> => {
      const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      const res = await fetch(`/api/v1/entities/${id}/revisions?${query}`, {
        headers: { authorization: formatBearer(await getRegisteredToken()) },
      });
      if (!res.ok) throw new RevisionsError(res.status);
      return (await res.json()) as RevisionPage;
    },
  };
}
