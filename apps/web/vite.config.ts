import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** §1.4 — Vite proxies /api, single origin in dev. */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
