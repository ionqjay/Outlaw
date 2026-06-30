# Supabase Migration (Render app)

## 1) Create tables
Run `supabase/schema.sql` in Supabase SQL Editor.

## 2) Enable RLS and policies
Run `supabase/002_enable_rls.sql` after the baseline schema.

This enables row-level security for:
- `signups`
- `owner_requests`
- `repair_requests`
- `bids`
- `feedbacks`
- `billing_accounts`

Owners can access their own repair requests. Mechanics/shops can access their own bids. Admins are elevated through Supabase JWT metadata role `admin`. The backend service-role key remains server-only and bypasses RLS for controlled API operations.

## 3) Add Render env vars
In Render service settings, add:
- `SUPABASE_URL` = your project URL (e.g. `https://xyz.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` = service role key (server-only)

Keep key secret. Never expose in client JS.

## 4) Redeploy Render
After env vars are set, redeploy.

## 5) Verify write path
- Submit `/api/signup` from site
- Create/login as an owner and submit a request from `/owner-app.html`
- Open `/admin?token=...` and confirm rows appear

## 6) Optional backfill from JSON
If you have existing local files (`signups.json`, `owner_requests.json`), import into Supabase with CSV or SQL inserts.

## Current fallback behavior
If Supabase env vars are missing, app falls back to local JSON files. Auth fallback is dev-only and requires `ALLOW_DEV_AUTH=true` outside production.
