import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2020', outDir: 'dist' },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    testTimeout: 180000,
  },
});
