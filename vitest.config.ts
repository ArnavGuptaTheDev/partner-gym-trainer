import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-08-15',
          d1Databases: ['DB'],
          r2Buckets: ['PHOTOS'],
          bindings: {
            TEST_MIGRATIONS: migrations,
            SUPER_USER_EMAILS: 'boss@example.com, Second@Example.com',
            ALLOWED_ORIGINS: '',
          },
        },
      }),
    ],
    test: {
      include: ['tests/**/*.test.ts'],
      setupFiles: ['./tests/setup.ts'],
    },
  };
});
