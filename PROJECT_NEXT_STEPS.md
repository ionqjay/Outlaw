# Project Next Steps (Execution Plan)

Updated: 2026-03-17

## 1) Verify Security Hardening on Deployed Beta (Highest Priority)

Goal: confirm production no longer leaks private marketplace/contact data.

### Critical smoke checks
- [ ] Unauthenticated `GET /api/repairs` returns 401 in production
- [ ] Unauthenticated `GET /api/bids` returns 401 in production
- [ ] Owner account can only see its own repair requests
- [ ] Mechanic/shop account can only see invited/sanitized repairs and own bids
- [ ] Owner email/phone metadata is not present in provider repair responses
- [ ] Provider email/phone metadata is only shown to authorized owner/admin views
- [ ] Repair cancel/complete verifies owner or admin authorization
- [ ] Bid accept verifies owner or admin authorization
- [ ] Feedback creation verifies owner, completed repair, and accepted bid

---

## 2) Apply Supabase RLS Migration

Goal: move database from service-role-only trust to defense-in-depth policies.

### Required steps
- [ ] Run `supabase/schema.sql` for new installs, if needed
- [ ] Run `supabase/002_enable_rls.sql`
- [ ] Confirm RLS is enabled on core tables
- [ ] Set admin users with Supabase JWT metadata role `admin`
- [ ] Confirm service-role key is only present in Render, never browser config

---

## 3) Configure Stripe Test Mode

Goal: make the $99/month mechanic/shop subscription gate real.

### Required steps
- [ ] Create/confirm Stripe $99/month subscription product
- [ ] Set `STRIPE_PRICE_MECHANIC_MONTHLY`
- [ ] Set `STRIPE_PRICE_SHOP_MONTHLY` if shops need a separate price
- [ ] Set `STRIPE_SECRET_KEY`
- [ ] Set `STRIPE_WEBHOOK_SECRET`
- [ ] Set webhook endpoint to `/api/stripe/webhook`
- [ ] Confirm `/api/health` returns `stripeBillingReady: true`

---

## 4) Stabilize Admin Account Management

Goal: ensure admin operations are reliable before adding scope.

### Critical smoke checks
- [ ] Admin billing/accounts screen loads without console errors
- [ ] Merged auth + billing list renders correctly (no duplicate/missing users)
- [ ] Ban/unban updates account behavior immediately
- [ ] Manual access override states work exactly:
  - [ ] `active` grants access
  - [ ] `disabled` blocks access
  - [ ] `null` falls back to normal billing
- [ ] Table actions still work after sorting/filtering/search

### API checks
- [ ] `/api/admin/billing` returns expected fields for UI
- [ ] `/api/admin/billing/:userId/manual-access` writes and persists state
- [ ] Admin token gate works (401 when missing/wrong token)

---

## 5) Close Invite Lifecycle Edge Cases

Goal: prevent provider invite dead-ends and support churn.

### Core lifecycle checks
- [ ] New invite gets `expires_at` window based on urgency
- [ ] Countdown displays correctly in UI
- [ ] Expired pending invites are marked expired and replacements are generated
- [ ] No duplicate replacements for same provider/type
- [ ] If request itself is expired, no new invites are created

### Edge-case scenarios
- [ ] Invite expires while provider is viewing request
- [ ] Provider tries to accept just after expiry (correct rejection)
- [ ] Two near-simultaneous replacement paths do not create duplicate active invites
- [ ] Timezone display remains user-friendly while server uses ISO timestamps

---

## 6) Repo Hygiene

Goal: keep commits reviewable and avoid accidental noise.

### Completed now
- [x] Expanded `.gitignore` to exclude local assistant/workspace artifacts and temp exports.

### Follow-up
- [ ] Optionally move scratch analysis files into a dedicated `scratch/` folder (ignored)
- [ ] Keep production-relevant docs/code tracked; keep generated data untracked

---

## Suggested order for next pass
1. Apply Supabase RLS migration in hosted Supabase
2. Configure Stripe test mode env vars on Render
3. Redeploy and run production API privacy checks
4. Run full owner/mechanic/admin E2E QA
