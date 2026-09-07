/**
 * Setup for the `dom` vitest lane (bd startsim-edb00).
 *
 * Only `.test.tsx` files load this — the node lane never sees it, so the
 * pure-function suite keeps its DOM-free run.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React 19 + RTL 16 do not auto-cleanup without globals enabled, and this suite
// asserts on `document.body`, so a leaked tree from the previous test would make
// a later query match the wrong element.
afterEach(() => {
  cleanup();
});
