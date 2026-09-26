# ShopMyRepair launch handoff

Updated: 2026-09-26

## Verified state

- Supabase project `ntlsefkfbdnriknukjzl` was restored and reports ACTIVE_HEALTHY.
- Hosted migration `20260923002347_launch_security_and_operations.sql` was applied. Existing 12 repairs and 9 bids were preserved. Core tables are backend-only: RLS enabled, no anonymous/authenticated direct grants. Administrative role checks trust app_metadata only.
- Local test suite: 23 passing tests, including owner/provider completion flow, privacy, matching, duplicate repair submission, billing access, customer-scoped invoice selection, operational record isolation, refund review/idempotency, refund submission protection, sanitization, and navigation behavior.
- `npm audit --omit=dev`: zero reported vulnerabilities at verification time. This is not a comprehensive security audit.
- Public site inspection found a clear visual design but the quote button opened a waitlist modal. This branch directs owners into the actual repair workflow.

## Included in this branch

- ZIP-based provider service radius and specialties matching; complete profiles required before subscribing.
- Safer Stripe subscription status handling and monthly price validation; checkout reuse/idempotency.
- Persistent bans, invitations, reviews, in-app notifications, opportunity records, provider business review, and refund review queues.
- Atomic database bid creation and acceptance, production storage fail-closed behavior, real database health probes, restricted CORS, and asynchronous error handling.
- Password recovery screens, mobile navigation, HTML sanitization, pinned browser dependencies, and automated CI checks.
- Customer-scoped billing invoice API and a billing-month selector for opportunity-guarantee refund requests. Providers no longer need to copy raw invoice IDs from Stripe.
- Admin review UI at `/admin-launch.html` with an admin token supplied in a header.

## Required before production release

1. Connect the Vercel account/team that owns ShopMyRepair. The available connection returns no teams. Confirm the frontend project root is `public`, preview URL, custom domain, and deployment branch. Inspect a preview before merging.
2. Deploy this backend branch to a Render staging service, then production after staging checks. No Render management connection is available here. Use Node 22+, `npm ci --omit=dev`, `NODE_ENV=production`, and `/api/health` as the health check. Confirm all required environment variables without exposing secrets. Frontend and backend need a coordinated release; new frontend operational screens require these API routes.
3. In Supabase Auth, allow the exact production `/login.html` and `/reset-password.html` redirect URLs (both apex/www only if both are used), configure the sender, and enable leaked-password protection where available. Test signup confirmation, sign-in, recovery, and sign-out with a dedicated test account. These flows have not been exercised against live email.
4. Test Stripe checkout and signed webhook delivery in **test mode**, including payment failure, subscription cancellation, repeat checkout, billing-month invoice selection, refund review, pending refund, and refund failure. No payment or refund was executed during this work. Confirm prices are USD 99/month and configure the customer portal.
5. Run a full browser flow with dedicated test owner/provider accounts in staging: save ZIP/specialties/radius, post request, receive invitation, submit estimate, accept, complete, review, then reload and confirm persistence. Verify the mobile layout in a real viewport. Local DOM and API tests do not prove production behavior.
6. Confirm backup/PITR settings, monitoring, and operational ownership. Latest backend health probe from this environment timed out; investigate backend availability separately from Supabase health.

## Remaining limitations

- Job notifications are in-app only. Email/SMS delivery, retries, consent and delivery monitoring are not implemented for job events.
- Notification and invitation updates are separate from bid writes. A later write failure can leave a successful bid with a failed response or missing notification; add a transactional outbox/reconciliation before high volume.
- Atomic bid RPC enforces the global five-estimate limit; per-provider-type limits are also checked by the API but can race under simultaneous requests.
- Geographic distance uses ZIP centroids, not road travel distance.
- Business review is manual. An approved badge means details were reviewed; it is not insurance coverage, licensing certification, or a repair-quality guarantee.
- Refund approval needs human eligibility review, especially for periods before opportunity tracking began. In-app invitations alone do not prove delivery outside the app.
- After a Stripe refund has been submitted, the request cannot be changed back to another review decision in the admin UI/API. Resolve any pending or failed refund state in Stripe before further action.
- The legacy admin UI still supports a token in its URL. Prefer the new header-based admin review UI; migrate the legacy admin flow to authenticated sessions.
- Migration history has a version mismatch to reconcile before future migration pushes: the hosted database has the launch migration applied, while historical local migration files include older baseline/RLS paths. Do not rerun the old `002_enable_rls.sql`; its historical direct-client policies are superseded by backend-only access.

## Release and rollback

Keep this as a draft PR until hosting, browser, Auth and Stripe checks are complete. The database migration is additive except for intentional permission tightening; retain it during a code rollback. Do not restore permissive client policies. Roll back application deployments to the previously known-good commit if needed and recheck authenticated API access. Never delete customer records to undo this change.
