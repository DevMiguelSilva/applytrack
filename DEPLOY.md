# Deploy ApplyTrack

Use the existing Vercel project **job-tracker** and connect **DevMiguelSilva/applytrack**. Leave Root Directory empty; production branch is `main`. Preserve existing domains, environment scopes, Node version, function settings, and production deployment.

`vercel.json` supplies Vite, `npm run build`, output `dist`, and the SPA rewrite excluding `/api/`. Keep `api/` alongside the frontend.

## Environment

Copy `.env.example` to `.env` for local development and configure actual values privately. Keep the existing Vercel variables and scopes: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `GEMINI_API_KEY`, existing `GEMINI_MODEL*` overrides, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. Server credentials belong in server variables. Do not introduce new browser-exposed credentials during migration.

Run `npm ci`, `npm run dev`, `npm run build`, and `npm run lint` from repository root. Vite serves local `/api/*` through the existing plugin.

## Database

Keep the current Supabase project and data. `supabase/schema.sql`, `supabase/migrations/`, and `supabase/verify_*.sql` remain here. This repository split requires no SQL changes or new database project. Apply future schema changes deliberately using the existing migration process.

## Release and rollback

Deploy a non-main branch as a preview first. Check deep-link refresh, sign-in and existing cloud data, listing requests, AI requests, and DOCX export. Promote the verified deployment, retaining the previous production deployment for Vercel rollback. Production domains remain `applytrack-board.vercel.app` and `portafolio-mu-two-49.vercel.app`.

The original repository is retained as `DevMiguelSilva/portfolio-monorepo-archive`; relevant app history is preserved here.
