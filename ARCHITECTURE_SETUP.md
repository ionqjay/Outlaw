# Target Architecture

GitHub → Vercel (UI) → Render (API) → Supabase (DB)

## 1) Vercel (frontend only)
- Deploy from this repo
- In Vercel project settings:
  - **Framework Preset:** Other
  - **Root Directory:** `public`
  - **Build Command:** none
  - **Output Directory:** `.`

This serves `index.html`, `owner.html`, `script.js`, `owner.js`, `styles.css`.

## 2) Render (backend API)
- Keep Node service running from repo root (`server.js`)
- Set env vars:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CORS_ORIGINS=https://shopmyrepair.vercel.app,https://beta.shopmyrepair.com,http://localhost:3000`
  - existing Twilio/Mailchimp/Turnstile vars

## 3) Supabase (database)
- Run `supabase/schema.sql` in SQL Editor
- Backend writes to:
  - `signups`
  - `owner_requests`

## 4) Frontend API base behavior
- If site hostname includes `vercel.app`, frontend calls API at:
  - `https://beta.shopmyrepair.com`
- Otherwise uses same-origin API (`/api/...`) for Render-hosted beta.

## 5) Validation checklist
1. Open Vercel URL
2. Submit owner signup + OTP
3. Confirm redirect to `owner.html`
4. Submit owner request
5. Confirm row in Supabase table `owner_requests`
6. Confirm `/admin?token=...` on Render shows signups
