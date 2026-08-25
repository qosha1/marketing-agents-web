/**
 * Build an Authorization header, or refuse.
 *
 * WHY A FUNCTION FOR ONE TEMPLATE STRING. Because the template string was the
 * bug. Measured in production 2026-08-24, the Translate button sent
 * `Authorization: Bearer [object Promise]` — `getRegisteredToken()` is async and
 * the call site interpolated it unawaited. Django rejected it, the detached
 * translation job died on its first tenant call with a 401, and the UI still
 * said "Translating…" because the 202 is returned before the job runs. Translate
 * had been dead since 2026-08-19 with nothing to show for it but one log line.
 *
 * The `?? ''` guard that was there could never fire: a Promise is not nullish.
 * So this refuses on TYPE rather than on falsiness — the failing value was
 * always truthy and always wrong.
 */
export function formatBearer(token: string | null | undefined): string {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('Not signed in.');
  }
  return `Bearer ${token}`;
}
