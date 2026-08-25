/**
 * The Authorization header the Translate button sends.
 *
 * MEASURED IN PRODUCTION, 2026-08-24. The button sent, literally:
 *
 *   Authorization: Bearer [object Promise]
 *
 * `getRegisteredToken()` is `async`, and the call site interpolated it into a
 * template string without awaiting. Django rejected it, the detached job died on
 * its very first tenant call with a 401, and the only trace was one log line —
 * so Translate had been silently dead since the two live translations were made
 * on 2026-08-19. Nothing surfaced it: the button reported success, because the
 * 202 comes back before the job runs.
 *
 * `?? ''` did not help and could not: a Promise is never nullish, so the
 * fallback was unreachable. That is the shape of the bug — a value that is
 * always truthy and always wrong.
 */
import { describe, expect, it } from 'vitest';

import { formatBearer } from '@/lib/bearer';

describe('formatBearer', () => {
  it('formats a real token', () => {
    expect(formatBearer('abc.def.ghi')).toBe('Bearer abc.def.ghi');
  });

  it('REFUSES a Promise instead of stringifying it', () => {
    // The whole reason this function exists.
    expect(() => formatBearer(Promise.resolve('abc') as unknown as string)).toThrow(/not signed in/i);
  });

  it('refuses null, undefined and blank — an unauthenticated call must not be sent', () => {
    for (const bad of [null, undefined, '', '   ']) {
      expect(() => formatBearer(bad as unknown as string)).toThrow(/not signed in/i);
    }
  });

  it('refuses anything that is not a string, however truthy', () => {
    for (const bad of [42, {}, [], true]) {
      expect(() => formatBearer(bad as unknown as string)).toThrow(/not signed in/i);
    }
  });

  it('never produces a header containing "[object", whatever it is handed', () => {
    for (const bad of [Promise.resolve('x'), {}, [1], () => 'x']) {
      let header = '';
      try {
        header = formatBearer(bad as unknown as string);
      } catch {
        header = '';
      }
      expect(header).not.toContain('[object');
    }
  });
})
