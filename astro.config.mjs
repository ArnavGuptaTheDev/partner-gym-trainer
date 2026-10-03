import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// Static site, served as Workers Static Assets; the API is the Worker in /worker.
export default defineConfig({
  output: 'static',
  integrations: [preact()],
  build: { format: 'file' },
  vite: {
    server: {
      // `npm run dev` runs wrangler on 8788 for /api.
      proxy: { '/api': { target: 'http://localhost:8788', changeOrigin: false } },
    },
  },
});
