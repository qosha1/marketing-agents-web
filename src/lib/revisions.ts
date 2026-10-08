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
import {
  revisionFeedParams,
  type FieldAuthorsClient,
  type FieldAuthorsResponse,
  type RestoreOutcome,
  type RestoreRequest,
  type RevisionClient,
  type RevisionFeedClient,
  type RevisionFeedPage,
  type RevisionFeedQuery,
  type RevisionPage,
  type RevisionQuery,
} from '@startsimpli/ui/history';

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

async function authHeaders(): Promise<Record<string, string>> {
  return { authorization: formatBearer(await getRegisteredToken()) };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * The injected reader — and restorer — for ONE record's trail.
 *
 * `restore` (bd startsim-vehzd; route bd startsim-ti1yv) POSTs to
 * `/entities/<id>/revisions/<N>/restore` with the precondition in ONE spelling,
 * the body's `expected_version`, and never also `If-Match`: the server checks
 * both and refuses if EITHER disagrees, so two spellings can refuse a request by
 * themselves. It RESOLVES every answer with its status and body — a 412 carries
 * `current_version`, which the shared panel needs — rather than throwing it away.
 */
export function revisionClient(id: number | string): RevisionClient {
  return {
    list: async ({ page = 1, pageSize = 50, field }: RevisionQuery): Promise<RevisionPage> => {
      const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      // ?field= narrowing (bd startsim-jkkn7.8). Declared name, verbatim.
      if (typeof field === 'string' && field) query.set('field', field);
      const res = await fetch(`/api/v1/entities/${id}/revisions?${query}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new RevisionsError(res.status);
      return (await res.json()) as RevisionPage;
    },
    restore: async ({ version, fields, expectedVersion }: RestoreRequest): Promise<RestoreOutcome> => {
      const res = await fetch(`/api/v1/entities/${id}/revisions/${version}/restore`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(fields && fields.length ? { fields } : {}),
          expected_version: expectedVersion,
        }),
      });
      return { status: res.status, body: await readJson(res), headers: res.headers };
    },
  };
}

/**
 * "Last edited by X, when" for every field of one record (bd startsim-5n9ha;
 * route bd startsim-6sso4). Raw for the same reason as the trail: its `fields`
 * map is keyed by the tenant's declared attribute names.
 */
export function fieldAuthorsClient(id: number | string): FieldAuthorsClient {
  return {
    get: async (): Promise<FieldAuthorsResponse> => {
      const res = await fetch(`/api/v1/entities/${id}/field-authors`, { headers: await authHeaders() });
      if (!res.ok) throw new RevisionsError(res.status);
      return (await res.json()) as FieldAuthorsResponse;
    },
  };
}

/**
 * Every edit across records, newest first (bd startsim-1pqb9; route bd
 * startsim-ivr3n). CURSOR paged — there is no count and `?page=` is a 400 — and
 * the route also 400s an unknown parameter and a BLANK `actor` or `scope`, so
 * the filters go through the shared allowlist, which drops blanks.
 */
export function revisionFeedClient(): RevisionFeedClient {
  return {
    list: async (q: RevisionFeedQuery): Promise<RevisionFeedPage> => {
      const query = new URLSearchParams(revisionFeedParams(q) as Record<string, string>);
      if (typeof q.cursor === 'string' && q.cursor) query.set('cursor', q.cursor);
      if (typeof q.pageSize === 'number') query.set('page_size', String(q.pageSize));
      const qs = query.toString();
      const res = await fetch(`/api/v1/revisions${qs ? `?${qs}` : ''}`, { headers: await authHeaders() });
      if (!res.ok) throw new RevisionsError(res.status);
      return (await res.json()) as RevisionFeedPage;
    },
  };
}
