/**
 * Where the Translate action reaches the tenant backend, and on what terms it
 * talks to a model (bd startsim-bxkd).
 *
 * Pure and injectable so both answers are unit-tested rather than discovered in
 * production, which is exactly how they were nearly got wrong — and, for the
 * first one, how they WERE got wrong for two weeks (startsim-mpijc):
 *
 *  - THE DEPLOYED BACKEND IS NGINX ON LOOPBACK, port 80. Not `DJANGO_API_URL`,
 *    which is set only locally (`materialize.py` writes it for the dev gateway)
 *    and would point a deployed handler at ITSELF. And no longer
 *    `django.${TENANT_DNS_NAMESPACE}:5000` either: the grouping migration
 *    (`startsim-wyn2`, 2026-08-20) collapsed django into the `<slug>-nginx` TASK
 *    as a container, and Cloud Map registers SERVICES — so that name stopped
 *    resolving the day it landed, and every server-side tenant call in every
 *    fork has been unreachable since. Verified live 2026-09-05:
 *    foundry-tenant-marketing-agents.local registers only [postgres, nginx].
 *
 *    The task is `networkMode: awsvpc` and all five containers (nginx:80,
 *    django, frontend:3000, redis, reingest) share its network namespace, so
 *    `localhost` reaches any of them. nginx is the deliberate choice over
 *    django's own 127.0.0.1:5000:
 *      * it is the SAME path the browser takes, so there is one routing story
 *        and not a second copy of it living in this app — which is the exact
 *        drift that caused this outage;
 *      * it already proxies `/api/` to `${NGINX_UPSTREAM}` (literally
 *        `127.0.0.1:5000` in the runtime bundle), so if django ever moves again
 *        nginx follows it and this file does not have to;
 *      * it preserves the explicit `Host` this module sends
 *        (`proxy_set_header Host $http_host`) and appends the trailing slash
 *        DRF needs, so both the recorded traps stay covered rather than
 *        re-implemented.
 *    One behavioural difference to know about: nginx routes `/api/v1/auth/*` to
 *    CENTRAL (`api.startsimpli.com`), not to the tenant. No caller here uses an
 *    `auth/` path — they read entities, relationships and schemas — but a future
 *    one would reach central, which is where tenant auth actually lives.
 *
 *  - THE RETENTION POSTURE IS A DEPLOYMENT PROPERTY, not a preference
 *    (`startsim-hopl`, `startsim-yfot`). This app is one tenant's product UI and
 *    its material is news-derived marketing content, which `startsim-yfot`
 *    classifies as the `open` posture by name. That is why `open` is the default
 *    HERE and why it is written down rather than assumed. A walled deployment —
 *    the paying client's, where the confidentiality claim is being sold — is a
 *    different surface (`startsim-qohz`) and must set TRANSLATION_POSTURE
 *    explicitly; it does not inherit this file's default.
 *
 * Every value stays overridable from the environment, so moving this tenant to
 * another provider or model is a config change and not a deploy of new code.
 */

/**
 * The tenant nginx, in this task's own network namespace. No port: it listens on
 * 80, and `node:http` defaults an empty port to 80 for `http:`.
 *
 * THE IPv4 LITERAL, NOT `localhost`, AND THAT IS MEASURED. In the live frontend
 * container `/etc/hosts` carries BOTH `127.0.0.1 localhost` and `::1 localhost`,
 * while the tenant nginx declares only `listen 80` — IPv4. Node resolves the
 * name v4-first today (`dns.lookup('localhost', {all: true, verbatim: true})`
 * returns `[127.0.0.1, ::1]`, checked on the running task), so the name WOULD
 * work — but that is an ordering dependency a base-image bump or a
 * `--dns-result-order` default could flip, and this whole outage was a hostname
 * that quietly stopped resolving. The literal removes the lookup entirely, and
 * it is what the platform already uses for every in-task hop: NGINX_UPSTREAM is
 * `127.0.0.1:5000`, NGINX_FRONTEND is `127.0.0.1:3000`, and django's own ECS
 * health check curls `http://127.0.0.1:5000`.
 */
const TENANT_NGINX_BASE = 'http://127.0.0.1';

/**
 * Defaults for THIS tenant, chosen against what the deployment actually holds:
 * its runtime bundle carries a real `OPENAI_API_KEY` and no Anthropic key.
 * `startsim-yfot` excludes OpenAI only from the WALLED posture; on `open` any
 * configured provider is permitted, which is the case here.
 */
const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_ALLOWED_MODELS = 'gpt-5.2,gpt-5.1,gpt-4o';
const DEFAULT_POSTURE = 'open';

export type Env = Record<string, string | undefined>;

/**
 * The `Host` header a server-side tenant call must carry.
 *
 * Django checks ALLOWED_HOSTS against the Host header, and a tenant's is just
 * its public domain. Going through nginx does NOT make this optional: nginx
 * forwards what it is given (`proxy_set_header Host $http_host`), so a call that
 * sends nothing has `localhost` derived from the URL forwarded on its behalf and
 * Django answers 400 "Invalid HTTP_HOST header" before any view runs — the same
 * failure as a direct call, one hop later. DJANGO_ALLOWED_HOSTS is already wired
 * into the frontend task def, so the right value is in hand — it just has to be
 * sent.
 *
 * Note Node's fetch cannot do this: undici derives Host from the URL and
 * silently drops an explicit one, which is why the caller uses node:http.
 */
export function tenantHost(env: Env): string | undefined {
  const first = (env.DJANGO_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0)[0];
  return first;
}

/**
 * The base URL for server-side tenant API calls. Deployed first, local second —
 * the deployed case is the one that has no second chance.
 *
 * TENANT_DNS_NAMESPACE remains the "am I deployed?" signal even though the
 * answer no longer contains a namespace: `provision_tenant` puts it in every
 * tenant's runtime bundle and therefore in every container's environment, while
 * nothing local sets it. Confirmed against the live frontend container's
 * `secrets`, which carry TENANT_DNS_NAMESPACE / NGINX_UPSTREAM / NGINX_FRONTEND
 * and no DJANGO_API_URL.
 */
export function tenantApiBase(env: Env): string {
  const namespace = env.TENANT_DNS_NAMESPACE?.trim();
  if (namespace) return TENANT_NGINX_BASE;

  const local = env.DJANGO_API_URL?.trim();
  if (local) return local.replace(/\/+$/, '');

  return 'http://localhost:8001';
}

/**
 * The environment `resolveTranslationRoute` validates, with this tenant's
 * defaults filled in. The engine stays strict — it still refuses an unknown
 * posture, a model outside the allow-list and a Covered Model on a walled
 * route. This only decides what an unset variable means for THIS app.
 */
export function translationEnv(env: Env): Env {
  return {
    ...env,
    TRANSLATION_POSTURE: env.TRANSLATION_POSTURE ?? DEFAULT_POSTURE,
    TRANSLATION_PROVIDER: env.TRANSLATION_PROVIDER ?? DEFAULT_PROVIDER,
    TRANSLATION_MODEL: env.TRANSLATION_MODEL ?? DEFAULT_MODEL,
    TRANSLATION_ALLOWED_MODELS: env.TRANSLATION_ALLOWED_MODELS ?? DEFAULT_ALLOWED_MODELS,
  };
}
