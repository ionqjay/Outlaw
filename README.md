# Outlaw V1

Clean V1 baseline for ShopMyRepair marketplace.

## Stack
- Frontend: static pages in `public/` (deploy on Vercel)
- Backend API: Node/Express in `server.js` (deploy on Render)
- Database: Supabase (`supabase/schema.sql`)

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
- `ADMIN_TOKEN`
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

Run both SQL files in order:

1. `supabase/schema.sql`
2. `supabase/002_enable_rls.sql`

The RLS migration enables row-level security on the core tables and adds owner/provider/admin policies. The backend still uses the service-role key server-side only for controlled API operations.

## Beta Gate

Do not mark the app beta-ready until:

- `/api/health` returns `ok: true` in production.
- `stripeBillingReady` is true.
- Supabase RLS migration has been applied.
- `npm test` and `npm audit --audit-level=moderate` pass.
