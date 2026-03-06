# Supabase Migration (Render app)

## 1) Create tables
Run `supabase/schema.sql` in Supabase SQL Editor.

## 2) Add Render env vars
In Render service settings, add:
- `SUPABASE_URL` = your project URL (e.g. `https://xyz.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` = service role key (server-only)

Keep key secret. Never expose in client JS.

## 3) Redeploy Render
After env vars are set, redeploy.

## 4) Verify write path
- Submit `/api/signup` from site
- Submit owner request from `/owner.html`
- Open `/admin?token=...` and confirm rows appear

## 5) Optional backfill from JSON
If you have existing local files (`signups.json`, `owner_requests.json`), import into Supabase with CSV or SQL inserts.

## Current fallback behavior
If Supabase env vars are missing, app falls back to local JSON files. This keeps beta running during migration.
