# Spotter

An invite-only, mobile-first gym app for two. Partners (a couple or gym buddies) set each other's diet and workout plans, log their days, share gym photos, chat, and keep a shared streak alive. It runs entirely on Cloudflare's free tier: Pages, Pages Functions, D1 and R2.

## Stack

| Layer | What |
|---|---|
| Frontend | Astro (`output: "static"`), Preact islands for stateful screens, vanilla TS for small scripts |
| API | One Cloudflare Pages Function (`functions/api/[[path]].ts`) with a small router and shared middleware in `functions/_lib` |
| Database | Cloudflare D1, versioned SQL migrations in `migrations/` |
| Photos | Private Cloudflare R2 bucket, only served via the authenticated `/api/photos/:id` |
| Fonts | Bricolage Grotesque (display) + Inter (text), self-hosted via Fontsource, Latin subset, `font-display: swap` |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` (real workerd + D1 + R2 locally) |

## Repository layout

```
src/
  content/copy.ts      ← ALL user-facing copy (incl. couple vs friends tone)
  pages/               Astro pages (one per screen)
  islands/             Preact islands (Home, Plan, Log, Photos, Chat, Admin…)
  layouts/, components/
  lib/                 client helpers (api, image compression, units, hooks)
  styles/              design tokens (light/dark), fonts
functions/
  api/[[path]].ts      Pages Function entry for /api/*
  _lib/                router, middleware, validation, crypto, routes/*
migrations/            0001…0007 D1 migrations
scripts/               dev runner, seed script, icon generator
tests/                 API tests (auth, invites, pairing, authorization, …)
public/                manifest, icons, _headers (security headers)
```

## Local development

Requirements: Node 20+ (tested on Node 24) and npm.

```bash
npm install
cp .dev.vars.example .dev.vars          # sets SUPER_USER_EMAILS for local dev
npm run db:migrate:local                # create local D1 tables
npm run db:seed:local                   # optional: two paired demo users + a week of data
npm run dev                             # API on :8788, Astro on :4321
```

Open http://localhost:4321.

- **Demo logins:** `alex@example.com` and `sam@example.com`, password `spotter-demo-1`. Alex is listed in `.dev.vars.example` as a super user, so you can try the Admin page. Alex's first Home load unlocks the 7-day-streak milestone.
- **Starting from scratch:** go to `/register` and sign up with an email listed in `SUPER_USER_EMAILS`. Super users don't need an invite.
- **How `npm run dev` works:** it runs `wrangler pages dev dist --port 8788` for the API and `astro dev` for hot-reloaded pages. Astro proxies `/api` to wrangler. That's why `ALLOWED_ORIGINS=http://localhost:4321` is in `.dev.vars`: the API rejects cross-origin writes otherwise.
- **When you change the API:** wrangler watches `functions/` and reloads.
- **Production-like run:** `npm run preview` builds the site and serves everything from wrangler on :8788.

Local D1 and R2 data live in `.wrangler/state`. Delete that folder to start over, then re-run the migrate and seed commands.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API + Astro dev servers |
| `npm run build` | Static build into `dist/` |
| `npm run preview` | Build, then serve site + API with wrangler |
| `npm test` | Run the test suite (workerd, in-memory D1/R2) |
| `npm run typecheck` | Type-check functions/tests and the frontend |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations |
| `npm run db:seed:local` | Seed demo data (local only) |
| `npm run deploy` | Build and `wrangler pages deploy dist` |

## Database migrations

Migrations are plain SQL files in `migrations/`, applied in order and tracked by wrangler in the `d1_migrations` table.

```bash
npx wrangler d1 migrations create spotter add_something   # new numbered file
npm run db:migrate:local                                   # apply locally
npm run db:migrate:remote                                  # apply to production
```

The tests apply the same migrations automatically (`tests/setup.ts`).

## Deploying to Cloudflare Pages

You need a Cloudflare account; everything below fits the free plan. Log in once with `npx wrangler login`.

1. **Create the D1 database**

   ```bash
   npx wrangler d1 create spotter
   ```

   Copy the printed `database_id` into `wrangler.toml` under `[[d1_databases]]`.

2. **Create the R2 bucket** (private by default; don't enable public access or an r2.dev URL)

   ```bash
   npx wrangler r2 bucket create spotter-photos
   ```

3. **Create the Pages project and apply migrations**

   ```bash
   npx wrangler pages project create spotter --production-branch main
   npm run db:migrate:remote
   ```

4. **Set `SUPER_USER_EMAILS`.** In the dashboard, open Workers & Pages → spotter → Settings → Variables and Secrets. Add `SUPER_USER_EMAILS` with a comma-separated list of emails, e.g. `you@example.com,friend@example.com`, for both Production and Preview. You can also set it from the CLI:

   ```bash
   npx wrangler pages secret put SUPER_USER_EMAILS --project-name spotter
   ```

   Leave `ALLOWED_ORIGINS` empty in production. The site and API share one origin there.

5. **Deploy**

   ```bash
   npm run deploy
   ```

   The D1 and R2 bindings come from `wrangler.toml` (`DB` and `PHOTOS`). If you deploy through the dashboard's Git integration instead, use build command `npm run build` and output directory `dist`, and check that the bindings appear under Settings → Bindings.

6. **First login.** Visit `/register` on your deployed site and sign up with a super-user email. Then go to Settings → Admin to create invite links for everyone else.

### Environment variables

| Name | Required | Purpose |
|---|---|---|
| `SUPER_USER_EMAILS` | yes | Comma-separated. These emails can register without an invite and manage invites, accounts and storage. Checked on every request, so removing an email revokes super-user rights immediately. |
| `ALLOWED_ORIGINS` | dev only | Extra origins accepted on mutating requests (the Astro dev server). |

| Binding | Type | Name |
|---|---|---|
| `DB` | D1 | `spotter` |
| `PHOTOS` | R2 | `spotter-photos` |

## Editing copy and content

All user-facing text lives in **`src/content/copy.ts`**, grouped by screen (`auth`, `home`, `plan`, `log`, `photos`, `chat`, …).

- **Couple vs friends tone:** edit the `tone` object. `couple` is warm, `friends` is playful and competitive. Greetings, nudges, note prompts and the days-together counter all come from there.
- **Feed lines:** the `feed` object.
- **Milestone messages:** `home.milestones`.
- **Quick emoji in chat:** `chat.emoji`.
- **Reaction emoji:** `REACTION_EMOJI` in `functions/_lib/routes/social.ts`. The server validates against this list, so update `REACTIONS` in `src/islands/HomeView.tsx` to match.
- **Colours, fonts and spacing:** tokens at the top of `src/styles/global.css`, with dark-theme overrides.
- **PWA name and colours:** `public/manifest.webmanifest`. Regenerate icons with `python scripts/make-icons.py` (needs Pillow).

## How it works

### Auth and access
- **Passwords:** PBKDF2-SHA256 with 100,000 iterations (the Workers WebCrypto maximum) and a random 16-byte salt per user, compared in constant time.
- **Sessions:** 32-byte random tokens. Only their SHA-256 is stored in D1. They're sent as `HttpOnly; Secure; SameSite=Lax` cookies and last 30 days, sliding (renewed when under 15 days remain).
- **Rate limits:** fixed-window counters in D1, per IP. Login: 10 per 15 min. Register: 5 per hour. Pairing-code attempts: 10 per 15 min.
- **Invites:** single use, expire after 7 days, stored hashed. The link is shown once, at creation. Super users can list invites (with who used each), revoke them, and deactivate accounts. Deactivation signs the user out everywhere.

### Authorization middleware

Every API request passes through `functions/_lib/app.ts` → `middleware.ts`:

1. **Origin check:** rejects cross-origin writes.
2. **Session lookup:** one D1 batch loads the user and their pair together.
3. **Super-user guard:** applies to admin routes.
4. **`resolveWho`:** per-user data lives under `/api/u/:who/…`, where `:who` is only ever `me` or `partner`. Raw user IDs are never accepted. Each route declares a mode:
   - `read`: you or your partner.
   - `self`: you only. Used for logs, photos and profile.
   - `plan`: your partner edits your plan. You can edit your own only when the pair allows self-editing or you're unpaired.

Row-level writes also filter on `user_id`, so a forged row ID can't touch someone else's data.

### Pairing

Strictly one-to-one.
- `pairs.user_a_id` and `pairs.user_b_id` are each `UNIQUE`.
- A trigger blocks anyone who appears in either column of an existing pair, and another trigger makes pair members immutable.
- The code path checks both users too.

Unpairing deletes the pair row. Chat, reactions, nudges and notes cascade away with it. Each person keeps their own plan, logs, weights and photos, and immediately loses access to the other's.

### Photos

- **In the browser:** photos are decoded with EXIF orientation applied, resized to 1600 px on the long edge, and re-encoded through a canvas. That re-encode strips all EXIF, including GPS. The output is WebP at ~80% where the browser supports it, otherwise JPEG. Quality and size step down until the file is under 1 MB.
- **On the server:** the server checks the file signature, rejects any file that still has EXIF/XMP, enforces the 1 MB limit, and caps uploads at 10 per user per rolling 24 hours.
- **Serving:** bytes are only served by `/api/photos/:id`, to the owner or their current partner, with `Cache-Control: private`.

### Free-tier budget

- **Few D1 queries:** every endpoint makes a small, constant number of D1 queries, usually one batch. A plan save is ~6 statements however big the plan is, because it uses `json_each` bulk upserts. Home loads everything in one batch of ~14. Both stay well under the free plan's 50 queries per invocation.
- **Pagination:** every list endpoint is cursor-paginated (default 20, max 50). Day summaries are limited to 62-day ranges.
- **Polling:**
  - Chat polls every 5 s, only while the tab is visible.
  - The unread badge polls `/api/pulse` every 30 s, only while the tab is visible.
  - Two people chatting for an hour is about 1,500 requests; the free plan allows 100,000 a day.
- **CPU:** PBKDF2 at 100k iterations is the heaviest work (login and register only). Everything else is small JSON in and out.
- **Storage:** see Admin → Photo storage (R2 free tier: 10 GB).

> Note: on the Workers free plan the CPU limit is 10 ms per request. PBKDF2 at 100k iterations can go slightly over on some requests. Cloudflare tolerates occasional overruns, but if logins start failing with exceeded-CPU errors, the fix is the Workers Paid plan. Lowering the iteration count would go against the spec.

## Tests

```bash
npm test
```

The tests run inside workerd with a real (in-memory) D1 database and R2 bucket, and apply the actual migrations.

| File | Covers |
|---|---|
| `auth.test.ts` | Registration (super-user and invite paths), password hashing, cookie flags, hashed sessions, logout, expiry, rate limits, deactivation |
| `invites.test.ts` | Super-user-only access, 7-day expiry, single use, list/revoke, pagination |
| `pairing.test.ts` | Codes, one-to-one rules (API and schema trigger), stale codes, unpair/re-pair, settings |
| `authz.test.ts` | The `:who` middleware (unit and through the API), plan edit rules, third-party isolation, post-unpair access |
| `profile-plan.test.ts`, `daily-log.test.ts`, `photos.test.ts`, `chat.test.ts`, `social.test.ts` | The feature endpoints |

## Accessibility notes

- Semantic landmarks, a skip link, and labelled inputs throughout.
- Visible `:focus-visible` rings. Colour tokens meet WCAG AA contrast in both themes.
- Progress bars expose `role="progressbar"` with text values. Chat is a `role="log"` live region.
- Confetti and other animations are disabled under `prefers-reduced-motion`.
