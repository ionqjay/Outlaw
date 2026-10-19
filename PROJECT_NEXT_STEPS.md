# ShopMyRepair launch handoff

Updated: 2026-09-26

## Verified state

- Supabase project `ntlsefkfbdnriknukjzl` was restored and reports ACTIVE_HEALTHY.
- Hosted migration `20260923002347_launch_security_and_operations.sql` was applied. Existing 12 repairs and 9 bids were preserved. Core tables are backend-only: RLS enabled, no anonymous/authenticated direct grants. Administrative role checks trust app_metadata only.
- Local test suite: 24 passing tests, including owner/provider completion flow, privacy, matching, duplicate repair submission, billing access, customer-scoped invoice selection, operational record isolation, refund review/idempotency, refund submission protection, notification reconciliation, sanitization, and navigation behavior.
- `npm audit --omit=dev`: zero reported vulnerabilities at verification time. This is not a comprehensive security audit.
- Public site inspection found a clear visual design but the quote button opened a waitlist modal. This branch directs owners into the actual repair workflow.
- `https://beta.shopmyrepair.com/api/health` returned healthy with Stripe and Supabase configured. Local `/api/health` returned 200 and unauthenticated `/api/repairs` returned 401.
- Vercel reported the PR preview deployment as successful, but the public preview URL is protected by Vercel authentication from this environment, so the actual preview UI could not be inspected without Vercel access.
- Supabase advisors show leaked-password protection is disabled. RLS-with-no-policy findings are expected for the backend-only service-role model, but should be acknowledged during launch review.

## Included in this branch

- ZIP-based provider service radius and specialties matching; complete profiles required before subscribing.
- Safer Stripe subscription status handling and monthly price validation; checkout reuse/idempotency.
- Persistent bans, invitations, reviews, in-app notifications, opportunity records, provider business review, and refund review queues.
- Atomic database bid creation and acceptance, production storage fail-closed behavior, real database health probes, restricted CORS, and asynchronous error handling.
- Password recovery screens, mobile navigation, HTML sanitization, and pinned browser dependencies. GitHub Actions workflow upload remains blocked by the current OAuth token lacking `workflow` scope.
- Customer-scoped billing invoice API and a billing-month selector for opportunity-guarantee refund requests. Providers no longer need to copy raw invoice IDs from Stripe.
- Bid notification delivery is now best-effort so a notification write failure does not make a successfully saved estimate appear failed. Admin ops exposes missing bid-notification reconciliation and can backfill owner notifications.
- The launch SQL RPC definition now includes atomic per-provider-type estimate limits for the migration-history reconciliation pass. Do not push this blindly until Supabase migration history is reconciled.
- Admin review UI at `/admin-launch.html` with an admin token supplied in a header.

## Required before production release

1. Re-authenticate the Vercel connector or grant access to the `ionqjays-projects` scope. Confirm production branch, root directory, domains, and environment variables. The current preview URL redirects to Vercel login from this environment.
2. Deploy this backend branch to a Render staging service, then production after staging checks. No Render management connection is available here. Use Node 22+, `npm ci --omit=dev`, `NODE_ENV=production`, and `/api/health` as the health check. Confirm all required environment variables without exposing secrets. Frontend and backend need a coordinated release; new frontend operational screens require these API routes.
3. In Supabase Auth, allow the exact production `/login.html` and `/reset-password.html` redirect URLs (both apex/www only if both are used), configure the sender, and enable leaked-password protection where available. Test signup confirmation, sign-in, recovery, and sign-out with a dedicated test account. These settings are not exposed through the available Supabase tools here.
4. Test Stripe checkout and signed webhook delivery in **test mode**, including payment failure, subscription cancellation, repeat checkout, billing-month invoice selection, refund review, pending refund, and refund failure. No Stripe connector or dashboard access is available here, and no payment or refund was executed. Confirm prices are USD 99/month and configure the customer portal.
5. Run a full browser flow with dedicated test owner/provider accounts in staging: save ZIP/specialties/radius, post request, receive invitation, submit estimate, accept, complete, review, then reload and confirm persistence. Verify the mobile layout in a real viewport. This remains blocked until staging credentials/accounts are available and the preview is accessible.
6. Confirm backup/PITR settings, monitoring, and operational ownership. Supabase organization is on the free tier, so PITR/advanced backup guarantees may require a plan decision. Vercel runtime monitoring access is blocked by scope authorization; Render monitoring is not connected here.

## Remaining limitations

- Job notifications are in-app only. Email/SMS delivery, retries, consent and delivery monitoring are not implemented for job events.
- Notification and invitation updates are separate from bid writes. Bid submission now succeeds even if notification delivery fails, and admin reconciliation can backfill missing bid notifications. A transactional outbox is still recommended before high volume.
- The updated launch RPC definition enforces the global five-estimate limit and per-provider-type caps atomically, but the hosted RPC must not be changed until migration history is reconciled.
- Geographic distance uses ZIP centroids, not road travel distance.
- Business review is manual. An approved badge means details were reviewed; it is not insurance coverage, licensing certification, or a repair-quality guarantee.
- Refund approval needs human eligibility review, especially for periods before opportunity tracking began. In-app invitations alone do not prove delivery outside the app.
- After a Stripe refund has been submitted, the request cannot be changed back to another review decision in the admin UI/API. Resolve any pending or failed refund state in Stripe before further action.
- The legacy admin UI still supports a token in its URL. Prefer the new header-based admin review UI; migrate the legacy admin flow to authenticated sessions.
- Migration history has a version mismatch to reconcile before future migration pushes: the hosted database has the launch migration applied, while historical local migration files include older baseline/RLS paths. Do not rerun the old `002_enable_rls.sql`; its historical direct-client policies are superseded by backend-only access.

## Release and rollback plan

1. Stage backend on Render from `finish-marketplace-launch`, point the PR preview frontend at that staging URL, and smoke `/api/health`, unauthenticated 401s, and authenticated owner/provider APIs.
2. In Stripe test mode, complete checkout/webhook/cancellation/refund scenarios with dedicated test accounts. Do not use live keys or real charges.
3. In Supabase Auth, confirm redirect URLs, email sender, and leaked-password protection, then run signup/login/recovery/logout tests.
4. Run the full owner/provider marketplace flow on staging across desktop and mobile. Keep PR #2 as draft until all launch checks are green.
5. Production deploy should be coordinated: Render backend first, Vercel frontend immediately after, then health and browser smoke checks. Roll back app deployments to the previous known-good commits if health/auth/billing smoke checks fail; do not delete customer records or loosen database permissions.
