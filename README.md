# Outlaw V1

Clean V1 baseline for ShopMyRepair marketplace.

## Stack
- Frontend: static pages in `public/` (deploy on Vercel)
- Backend API: Node/Express in `server.js` (deploy on Render)
- Database: Supabase (`supabase/schema.sql`)

## Run locally
```bash
npm install
npm start
```
Open: `http://localhost:3000`

## Required env vars (Render)
- `ADMIN_TOKEN`
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

## Frontend API target
Set `public/config.js`:
```js
window.APP_CONFIG = {
  API_BASE: 'https://shopmyrepair.onrender.com'
};
```
