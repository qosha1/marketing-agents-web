/**
 * Where the Translate action reaches the tenant backend, and on what terms it
 * talks to a model (bd startsim-bxkd).
 *
 * Pure and injectable so both answers are unit-tested rather than discovered in
 * production, which is exactly how they were nearly got wrong:
 *
 *  - `DJANGO_API_URL` IS NOT SET IN A DEPLOYED TENANT. It only exists locally
 *    (`materialize.py` writes it for the dev gateway). In prod nginx routes
 *    `/api/*` to Django before Next sees it, so the frontend never needed it —
 *    and a server handler that defaulted to `http://localhost:8001` would be
 *    pointing at ITSELF. The deployed answer is the Cloud Map FQDN, built the
 *    same way nginx builds its own upstream
 *    (`resolver-entrypoint.sh`: `django.${TENANT_DNS_NAMESPACE}:5000`). Short
 *    names do not resolve: the ECS DNS search domain is the region default and
 *    cannot be per-tenant.
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

/** The tenant Django's port behind Cloud Map — the value nginx proxies to. */
const TENANT_API_PORT = 5000;

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
 * The `Host` header a direct-to-Django call must carry.
 *
 * Django checks ALLOWED_HOSTS against the Host header, and a tenant's is just
 * its public domain. nginx preserves it (`proxy_set_header Host $http_host`);
 * a server-side call that skips nginx does NOT, so Django sees
 * `django.<namespace>:5000` and answers 400 "Invalid HTTP_HOST header" before
 * any view runs. DJANGO_ALLOWED_HOSTS is already wired into the frontend task
 * def, so the right value is in hand — it just has to be sent.
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
 */
export function tenantApiBase(env: Env): string {
  const namespace = env.TENANT_DNS_NAMESPACE?.trim();
  if (namespace) return `http://django.${namespace}:${TENANT_API_PORT}`;

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
