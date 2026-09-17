/**
 * The scope a record carries (bd startsim-0r7ru).
 *
 * The tenant gates records by SCOPE: a row of a scoped type must carry a path,
 * and a reader only sees the scopes they hold. OGMC's content is `/ogmc`; an
 * agent test account has its own. Two triggers in this app hand a record to n8n,
 * which writes a NEW record back into the tenant — "Generate drafts" and
 * "Request revision" — so the path has to travel with them, or the write is
 * refused. Refused INVISIBLY: both webhooks answer "Workflow got started" before
 * anything is written, the routes return 202 on that, and nobody learns the
 * draft never landed. That is what happened to every revision from 2026-09-02.
 *
 * READ CAMEL-TOLERANTLY, SENT IN SNAKE, and the asymmetry is deliberate.
 * `readData` tries the camelised spelling first because the shared api client
 * camelCases response keys including the data blob, so a browser-fetched record
 * spells it `scopePath` while Django's own JSON spells it `scope_path` — a
 * client caller and a server caller of this function are looking at the same
 * attribute under two names. What goes ON THE WIRE is always `scope_path`,
 * because both n8n Set nodes read `$json.body.scope_path` literally.
 *
 * IT NEVER INVENTS A PATH. Absent reads as `undefined` and the caller omits the
 * key, matching the n8n side, which omits rather than defaults for the same
 * reason: a WRONG scope is worse than a refusal. A test account's revision
 * appearing in a paying customer's review queue is the failure the scope gate
 * exists to prevent, and a default in this app would hand it over directly.
 */
import { readData } from '@/lib/board';
import type { EntityRecord } from '@/lib/foundry-api';

/**
 * The attribute naming the scope a record belongs to. Declared on the topic and
 * draft types, and named ONCE here — the reader below and every caller that
 * puts it on the wire have to agree, and spelling it twice is how they drift
 * (the same argument as `TOPIC_REF_ATTR` in `topic-drafts.ts`).
 */
export const SCOPE_PATH_ATTR = 'scope_path';

/**
 * The scope path a record carries, or `undefined` when it carries none.
 *
 * A non-string value is `undefined` too, rather than coerced: `String(42)` is
 * '42' and `String(null)` is 'null', and neither is a scope anybody holds — a
 * coercing read would put a nonsense path on the wire, which is precisely the
 * "wrong scope" case that is worse than sending nothing. Blank and
 * whitespace-only are absent for the same reason.
 */
export function recordScopePath(data: EntityRecord['data'] | undefined): string | undefined {
  const raw = readData(data, SCOPE_PATH_ATTR);
  const path = typeof raw === 'string' ? raw.trim() : '';
  return path || undefined;
}
