/**
 * The scope a record carries (bd startsim-0r7ru).
 *
 * The tenant now gates records by SCOPE: a row of a scoped type must carry a
 * path, and a reader only sees the scopes they hold. Two triggers in this app
 * hand a record to n8n, which writes a NEW record back — so the path has to
 * travel with them or the write is refused (and refused invisibly: both
 * webhooks answer 200 before the writer runs).
 *
 * THE ASYMMETRY IS THE POINT AND IS TESTED HERE. It is READ camel-tolerantly —
 * the shared api client camelCases response keys, blob included, so a live row
 * can spell it `scopePath` — and it is SENT in snake_case, because both n8n Set
 * nodes read `$json.body.scope_path` literally. Reading one spelling only would
 * make this silently return nothing for half the corpus.
 *
 * AND IT NEVER INVENTS ONE. `undefined` for absent is not a nicety: the n8n
 * side omits the key rather than defaulting it, deliberately, because a WRONG
 * scope (an agent's sandbox revision landing in the customer's queue) is worse
 * than a refusal. An app that answered '/ogmc' here would hand it exactly that.
 */
import { describe, expect, it } from 'vitest';

import { recordScopePath, SCOPE_PATH_ATTR } from '@/lib/scope';

describe('recordScopePath', () => {
  it('reads the snake_case attribute the schema declares', () => {
    expect(recordScopePath({ scope_path: '/ogmc' })).toBe('/ogmc');
  });

  it('reads the camelCase spelling the api client produces', () => {
    // The client camelCases the data blob, so this is what a browser-fetched
    // record actually looks like. Missing it would drop the scope on every
    // client-side caller — i.e. on "Request revision", the whole bug.
    expect(recordScopePath({ scopePath: '/ogmc-agent-test' })).toBe('/ogmc-agent-test');
  });

  it('returns undefined — never a default — when the record carries no scope', () => {
    expect(recordScopePath({})).toBeUndefined();
    expect(recordScopePath(undefined)).toBeUndefined();
    expect(recordScopePath({ topic_ref: '42' })).toBeUndefined();
  });

  it('treats a blank or whitespace-only path as absent', () => {
    // An EMPTY scope_path is worse than no key: it is a value the writer would
    // have to decide about, and `''` is not a path anyone holds.
    expect(recordScopePath({ scope_path: '' })).toBeUndefined();
    expect(recordScopePath({ scope_path: '   ' })).toBeUndefined();
  });

  it('trims, so a stray space never becomes part of the path', () => {
    expect(recordScopePath({ scope_path: ' /ogmc-agent-test ' })).toBe('/ogmc-agent-test');
  });

  it('ignores a non-string value rather than coercing one into a path', () => {
    // `String(null)` is 'null' and `String(42)` is '42'; neither is a scope, and
    // both would be sent as one by a coercing read.
    expect(recordScopePath({ scope_path: null })).toBeUndefined();
    expect(recordScopePath({ scope_path: 42 })).toBeUndefined();
    expect(recordScopePath({ scope_path: { path: '/ogmc' } })).toBeUndefined();
  });

  it('names the attribute once, so the two halves cannot drift', () => {
    expect(SCOPE_PATH_ATTR).toBe('scope_path');
  });
});
