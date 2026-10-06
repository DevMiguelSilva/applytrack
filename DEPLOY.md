# Deploy ApplyTrack

Use the existing Vercel project **job-tracker** and connect **DevMiguelSilva/applytrack**. Leave Root Directory empty; production branch is `main`. Preserve existing domains, environment scopes, Node version, function settings, and production deployment.

`vercel.json` supplies Vite, `npm run build`, output `dist`, and the SPA rewrite excluding `/api/`. Keep `api/` alongside the frontend.

## Environment

Copy `.env.example` to `.env` for local development and configure actual values privately. Keep the existing Vercel variables and scopes: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `GEMINI_API_KEY`, existing `GEMINI_MODEL*` overrides, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. Server credentials belong in server variables. Do not introduce new browser-exposed credentials during migration.

Run `npm ci`, `npm run dev`, `npm run build`, and `npm run lint` from repository root. Vite serves local `/api/*` through the existing plugin.

## Database

Keep the current Supabase project and data. `supabase/schema.sql`, `supabase/migrations/`, and `supabase/verify_*.sql` remain here. This repository split requires no SQL changes or new database project. Apply future schema changes deliberately using the existing migration process.

## Release and rollback

Production custom address: `https://applytrack.miguelcode.dev`. Attach it to this existing Vercel project's Production environment. Cloudflare manages DNS only: use the exact CNAME Vercel recommends, DNS only, automatic TTL. Preserve Cloudflare nameservers and unrelated records; Vercel serves the app and HTTPS.

The existing Supabase project's Site URL is `https://applytrack.miguelcode.dev`. Allow the exact root return URL `https://applytrack.miguelcode.dev/` and retain existing local, preview, and Vercel return URLs. Current password sign-in and sign-up use the default client flow; there is no separate callback route. Email confirmation uses the configured Site URL when no redirect option is supplied. Keep Supabase service URLs, keys, database data, and schemas unchanged.

Users sign in again on the custom address to access cloud records. Browser-only records and sessions are origin-bound; keep old addresses usable without forced redirects or automatic storage transfer. Browser API requests remain relative `/api/adzuna/search` and `/api/gemini` on the same deployment.

Deploy a non-main branch as a preview first. Check deep-link refresh, sign-in and existing cloud data, listing requests, AI requests, and DOCX export. Promote the verified deployment, retaining the previous production deployment for Vercel rollback. Production domains remain `applytrack-board.vercel.app` and `portafolio-mu-two-49.vercel.app`.

The original repository is retained as `DevMiguelSilva/portfolio-monorepo-archive`; relevant app history is preserved here.
