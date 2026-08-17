import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'build' },
  server: {
    port: 3000,
    // `vercel dev` serves the functions in `api/`; in plain `vite dev` the proxy
    // below points at a locally-run function host so the browser never needs a
    // Strava client secret in either mode.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
