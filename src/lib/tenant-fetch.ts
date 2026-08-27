/**
 * Server-side calls to the tenant backend (bd startsim-bxkd, startsim-ozpjw.2).
 *
 * Extracted from `actions/translate-draft/route.ts`, which discovered every
 * constraint below the hard way. It is shared rather than copied because a
 * second handler now needs it: `actions/generate-drafts` re-checks a topic's
 * approval before it fires the writer, and that check is a tenant read.
 *
 * THE HOST HEADER IS THE WHOLE REASON THIS IS NOT `fetch`. Django validates
 * ALLOWED_HOSTS against it, and a tenant allows only its public domain. nginx
 * preserves it (`proxy_set_header Host $http_host`); a call that skips nginx
 * does not, so Django answers 400 "Invalid HTTP_HOST header" before any view
 * runs. Node's fetch cannot help here — undici derives Host from the URL and
 * silently drops an explicit one — so this uses node:http, which honours it.
 *
 * Going direct rather than hairpinning through the public ALB also keeps tenant
 * material inside the VPC.
 *
 * Deliberately NOT the shared browser client (`@/lib/api`): that one reads a
 * token from the browser and redirects to signin on 401, neither of which means
 * anything here. Callers forward the CALLER'S bearer instead of minting a
 * service token, so a handler can do exactly what the person who clicked could
 * have done.
 *
 * WIRE FORMAT, and the trap it sets: this returns Django's raw JSON. The shared
 * browser client snake_case -> camelCase transform is NOT applied here, so a
 * schema type arrives with `data_type`, not `dataType`. Anything that consumes
 * a camelCase shape must normalize first (see `topic-gate.ts`).
 */
import { request as httpRequest } from 'node:http';

import { tenantApiBase, tenantHost } from '@/lib/translation-config';

/**
 * Server-side base for the tenant backend. NOT `DJANGO_API_URL` — that is set
 * only locally, so in a deployed tenant a handler using it would point at
 * itself. See `translation-config.ts`; the deployed answer is the Cloud Map
 * FQDN nginx already proxies to.
 */
function tenantBase(): string {
  return tenantApiBase(process.env as Record<string, string | undefined>);
}

export async function tenantFetch<T>(
  path: string,
  auth: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  // The trailing slash goes on the PATH, never after a query string. DRF 301s a
  // slash-less POST into a GET (the recorded tenant-nginx failure), and naively
  // appending to the whole thing would have made `page_size=1` into `page_size=1/`.
  const [rawPath, rawQuery] = path.split('?');
  const url = new URL(`${tenantBase()}/api/v1/${rawPath}/${rawQuery ? `?${rawQuery}` : ''}`);
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const host = tenantHost(process.env as Record<string, string | undefined>);

  return new Promise<T>((resolve, reject) => {
    const req = httpRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: init.method,
        headers: {
          authorization: auth,
          'content-type': 'application/json',
          ...(host ? { host } : {}),
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            // Status, method and path only. The body can quote the draft, and a
            // translation product that logs client material has no wall to sell.
            reject(new Error(`tenant ${init.method} ${path} responded ${status}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch {
            reject(new Error(`tenant ${init.method} ${path} returned unparseable JSON`));
          }
        });
      },
    );
    req.on('error', () => reject(new Error(`tenant ${init.method} ${path} is unreachable`)));
    if (payload) req.write(payload);
    req.end();
  });
}
