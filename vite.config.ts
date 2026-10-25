import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import {univerHostPopovers,univerHostPopoversPrebundle} from './scripts/univer-host-popovers.mjs';
import {reactRefreshCspPlugin} from './scripts/dev-inline-csp.mjs';
import {runtimeFsDeny} from './shared/local-file-access.js';

export default defineConfig({
  base: './',
  // Runtime data must never be reachable through Vite's separate public/ URL mapping.
  publicDir: false,
  worker: { format: 'es' },
  build: { rollupOptions: { input: { main: path.resolve(__dirname,'index.html'), sheet: path.resolve(__dirname,'sheet.html') } } },
  plugins: [univerHostPopovers(), react(), reactRefreshCspPlugin(), tailwindcss()],
  optimizeDeps: {include:['@univerjs/preset-sheets-core/worker','@univerjs/preset-sheets-filter/worker'],esbuildOptions:{plugins:[univerHostPopoversPrebundle()]}},
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    fs: {deny:runtimeFsDeny(process.cwd())},
    hmr: process.env.DISABLE_HMR !== 'true',
    ws: process.env.DISABLE_HMR === 'true' ? false : undefined,
    watch: {
      // Generated reports, archives and local audit output must not trigger
      // HMR/full-page reloads while the app is open.
      ignored: [
        '**/.tmp/**',
        '**/.ai/**',
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
