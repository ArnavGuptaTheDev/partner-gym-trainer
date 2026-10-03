import { applyD1Migrations, env } from 'cloudflare:test';
import { installGoogleMock } from './helpers';

// Idempotent: records applied migrations in d1_migrations.
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);

// Google's token endpoint is never called for real in tests.
installGoogleMock();
