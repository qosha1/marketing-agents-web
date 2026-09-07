import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirror tsconfig "@/*" -> "./src/*" so runtime imports (e.g. lib/drafts ->
// @/lib/board) resolve under vitest the same way they do under Next.
// Declared per project on purpose: a top-level `resolve.alias` is NOT inherited
// by `test.projects`, so each lane has to carry it or half the suite stops
// resolving `@/`.
const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    // Two lanes, not one environment for everything (bd startsim-edb00). The
    // pure-decision tests are the bulk of the suite and they do not want a DOM:
    // giving every one of them a jsdom document costs seconds and buys nothing.
    // So `.test.ts` keeps its DOM-free `node` run exactly as it was, and only
    // `.test.tsx` — a rendered component — pays for jsdom.
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        // @startsimpli/ui ships raw .tsx, and a dependency is outside the
        // tsconfig that would otherwise tell esbuild to use the automatic JSX
        // runtime — without this every shared component renders as
        // "React is not defined".
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/__tests__/**/*.test.tsx'],
          setupFiles: ['./src/test/setup-dom.ts'],
        },
      },
    ],
  },
});
