# Outlaw V1

ShopMyRepair marketplace. Production is NOT certified operationally ready.

## Current handoff — 2026-11-10
- Reviewed source baseline: f083f87 (PR10). Planned shop price is $29.99/month, manual application/review; checkout and new requests remain closed.
- Stripe is deferred. Backend price attestation remains 9900 cents until a separately approved coordinated billing change. Do not enable billing from displayed pricing or mutate the attestation to match marketing copy.
- The three-second fail-closed readiness implementation shipped in PR9 and is included in the released baseline. Render healthCheckPath already has conditional approval, blocked until healthy-service proof; auto-deploy remains OFF. Code deployment does not mean the hosting health path is configured.
- Read-only public check 2026-11-10 18:33:30Z returned health503/databaseReady:false and availability200/billing disabled. Parent provider review reports Supabase ntlsefkfbdnriknukjzl INACTIVE on Free. No reactivation, backup recovery-point proof, export or restore occurred in this patch.
- SMS/Stripe setup and operational approvals remain separate. See PRODUCTION_OPERATIONS.md and the launch-team handoff for decisions, not historical claims below.

## Stack
- Frontend: static pages in `public/` (deploy on Vercel)
- Backend API: Node/Express in `server.js` (deploy on Render)
- Database: Supabase (reviewed migration history; historical SQL must not be replayed blindly)

## V1 Screens
- `/` marketing landing
- `/login.html` role-based sign in/sign up (owner vs mechanic/shop)
- `/owner-app.html` owner Home / Dashboard / Get a Quote
- `/mechanic.html` mechanic Home / Dashboard / Repairs

## Run locally
```bash
npm install
npm start
```
Open: `http://localhost:3000`

## Required env vars (Render)
- `APP_URL` (e.g. `https://shopmyrepair.com`)
- `TURNSTILE_SECRET` (optional for dev)
- `TWILIO_ACCOUNT_SID` (optional for dev)
- `TWILIO_AUTH_TOKEN` (optional for dev)
- `TWILIO_FROM_NUMBER` (optional for dev)
- `MAILCHIMP_API_KEY` (optional)
- `MAILCHIMP_AUDIENCE_ID` (optional)
- `MAILCHIMP_SERVER_PREFIX` (optional)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGINS`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MECHANIC_MONTHLY`
- `STRIPE_PRICE_SHOP_MONTHLY`
- `ALLOW_DEV_AUTH=true` only for local development, never production

## Frontend config
Set `public/config.js`:
```js
window.APP_CONFIG = {
  API_BASE: 'https://shopmyrepair.onrender.com',
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
};
```

If Supabase keys are left blank on localhost, app can use local dev auth mode only when the API has `ALLOW_DEV_AUTH=true`. Production login requires Supabase Auth.

## Supabase Security

**Historical SQL — do not replay:** `supabase/schema.sql` and `supabase/002_enable_rls.sql` are superseded setup paths, not current deployment instructions. Current core tables are backend-only; historical direct-client policies can weaken that boundary. Reconcile hosted migration history, grants, RPCs and private storage against reviewed migrations before any authorized change. Keep service-role credentials server-side. No schema changes are authorized by this README.

## Beta Gate

Do not mark the app beta-ready until:

- `/api/health` returns `ok: true` in production.
- Billing remains disabled unless a separate Stripe lifecycle/price release is approved and verified.
- Current backend-only access, migration history and private storage are independently verified; old RLS scripts are not replayed.
- `npm test` and `npm audit --audit-level=moderate` pass.
