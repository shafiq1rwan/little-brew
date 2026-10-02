import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // three.js alone is ~600 kB minified; one chunk is fine for this MVP.
  build: { chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
