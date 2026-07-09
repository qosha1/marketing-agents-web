import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Match the tsconfig "@/*" → "./src/*" path so runtime imports (e.g.
      // dashboard.ts → @/lib/board) resolve the same way in tests as in Next.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
