import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Lets a second checkout run its own API next to the default one. */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

/** §1.4 — Vite proxies /api, single origin in dev. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Before '/api' (first match wins). `changeOrigin: false` keeps the Host the
      // browser sent, which the API's same-origin check compares to Origin.
      '/api/socket.io': { target: apiTarget, ws: true, changeOrigin: false },
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
