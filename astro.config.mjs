import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// Static site; the API is served by Cloudflare Pages Functions in /functions.
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
