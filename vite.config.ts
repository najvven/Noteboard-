import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    ws: process.env.DISABLE_HMR === 'true' ? false : undefined,
    watch: {
      // Generated reports, archives and local audit output must not trigger
      // HMR/full-page reloads while the app is open.
      ignored: [
        '**/data/**',
        '**/release/**',
        '**/dist/**',
        '**/graphify-out/**',
        '**/playwright-report/**',
        '**/test-results/**',
        '**/.codex/**',
      ],
    },
  },
});
