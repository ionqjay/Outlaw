# Registered-shops-only slice — 2026-10-20

## Scope and preserved behavior
Owners remain free. Existing mechanic identities, subscriptions, billing portal access, quotes and history are preserved, not converted or deleted. New UI registrations and legacy signup API accept owner/shop only. Direct Supabase Auth signup may still create arbitrary metadata: this is not eligibility and grants no lead/quote/checkout access. Blocking raw Auth registration roles also requires a reviewed Supabase Auth hook; none was installed.

Server-owned provider_verifications records must explicitly say approved + registered_shop. Existing approvals are not grandfathered. Admin review requires registration reference and business address plus existing license/insurance references. A provider cannot self-set approval or business_type. Legacy approved records may resubmit evidence for review. Review is manual: the application does not validate government registries automatically.

New leads/quotes additionally require active subscription, subscription ID, future paid-period end, and no disabled override. Trialing and manual-active overrides do not grant access. User metadata is profile input, never verification. Current billing status is webhook-backed cache; webhook delays can delay revocation until cached period expiry. Live lifecycle verification remains required.

## Deployment dependency — DO NOT deploy automatically
No push was performed: GitHub reported a connected Vercel production deployment, and actual branch/Render auto-deploy settings could not be verified. Inspect hosting integration triggers before any push. No hosted settings, database or Stripe operations were performed.

Review and test supabase/migrations/20261020170000_registered_shops_only.sql on a separate staging database after the existing launch migration. It adds nullable review fields and a new create_shop_bid RPC; retains all data; expands signup constraint to preserve legacy mechanic records; revokes service-role EXECUTE on the old quote RPC. New RPC rechecks approval, subscription, invitation and ban under a repair-row lock and counts ALL quotes, including declined/legacy quotes. Existing requests with >=3 quotes retain them but cannot add more.

Coordinate a write-maintenance window: migration-first blocks old backend quote writes; code-first fails closed because the new RPC is absent. Missing new business_type denies approval/access. Do not silently fall back to old RPC. Existing subscriptions continue billing; communicate legacy account transition and offer existing billing portal cancellation. Do not cancel or convert automatically.

Before deployment: snapshot/backup and restoration drill; inspect real grants and RLS; verify service_role can read auth.users as required by the RPC; execute concurrent database tests; confirm migrations on staging. Transaction rollback protects migration application, but an application rollback alone does not restore old RPC permission. Do not re-enable insecure writes merely to recover availability.

Configure STRIPE_PRICE_SHOP_MONTHLY to an active USD 9900 recurring monthly price. No mechanic price fallback. Existing portal access remains. Verify test-mode checkout, signed webhook retries/payment failure/cancellation, and actual price against Stripe in staging before production.

## Tests and boundaries
npm run check runs Node syntax and tests. Tests use local persistence/mocked integrations; added policy, unauthorized endpoint, forged quote metadata, and local concurrent max-three coverage. SQL tests inspect source contracts only, NOT PostgreSQL execution. No claim of production RLS, real SQL concurrency, live Stripe or mobile browser validation.

## Remaining pilot blockers
- Staging Supabase SQL/RLS/concurrency and Stripe lifecycle evidence; production backup/rollback verification.
- Westchester explicit ZIP pilot boundary; recruit and manually approve 5–10 registered shops.
- Vehicle photo uploads, secure in-app messages, complete work-status/dispute workflows.
- Individually authenticated admins/action audit, rate-limit hardening, comprehensive input validation.
- Browser/mobile accessibility and visual QA; CI gate and deployment isolation.
- Shared cross-replica dispatch locking and reliable operational monitoring.
- Review guarantees/refund language, legacy subscriptions, and zero-quote support process.

Pilot metrics: eligible requests, first-quote p50/time-to-quote, >=1 quote by 24h (suggested >=80%), quote acceptance/completion, opportunities per shop, failed payments, support and refunds. Hard invariant: <=3 total quotes. Human review of every zero-quote request within one business day. Daily operations review and weekly shop interviews. The platform is NOT ready for an unassisted Westchester pilot from this slice alone.

## Follow-up review: history isolation and price attestation
Provider dashboard history now reads /api/provider/repair-history, which derives repair IDs only from the authenticated provider's own persisted bids. It ignores client-selected provider/owner IDs, does not dispatch or discover leads, and strips owner/contact/client metadata through the repair sanitizer. Legacy mechanics and expired approved shops retain their history; new lead discovery remains forbidden. A failed history-detail request still renders existing bid cards with request-number fallbacks. Banned users remain blocked by authentication policy.

48 local tests pass, including ownership-isolated history for legacy/expired providers and executable JSDOM coverage of dashboard rendering when lead access is denied or history details fail. No live service calls or database migrations were run for this follow-up.

Billing blocker: cached entitlement records do NOT attest subscription price, currency, product, quantity or interval. Checkout validates USD 99/month, but existing subscriptions and portal-modified subscriptions can diverge. Before pilot, persist and validate authoritative Stripe subscription item/price attestations on webhook/reconciliation, explicitly handle multi-item subscriptions, and test legacy/portal price changes in isolated Stripe test mode. Do not infer payment of the intended plan from active status alone. No live billing changes were made.

## Connected-service verification and entitlement follow-up
Read-only Supabase catalog queries against Shopmyrepair confirmed all 12 public application tables have RLS enabled, zero policies, and no anon/authenticated table grants. Existing quote/accept RPC EXECUTE grants are postgres/service_role only. Live provider_verifications and billing_accounts lack the new business-review and attestation columns; create_shop_bid is absent. Neither pending migration has been applied. No customer rows were queried.

Vercel project inspection using explicit project/team IDs returned HTTP 403: target team scope ionqjays-projects is not authorized for this MCP connection. No vercel CLI available as fallback. Grant the connection target-team access, not merely account sign-in. Render/Stripe tools and CLIs were not exposed; loaded plugin inventory had Vercel but no Render/Stripe. Branch auto-deployment remains unverified: no push/PR/deployment.

Implemented exact Stripe subscription-item attestation: one complete item, quantity one, expected price ID, USD 9900, month/interval_count one. Server retrieval during billing synchronization and webhook processing replaces the attestation, including invalidation after portal plan changes. New migration 20261021010000_shop_plan_attestation.sql adds fail-closed fields and updates the quote RPC. Old active subscriptions are NOT grandfathered. Attestations expire after 24h; subscription status/period still independently checked. Missing/invalid/stale attestation denies leads and quotes, while owner flow/history remain accessible. No actual Stripe request was made during this work.

Cache limitations: a missed webhook can leave previously attested access valid for up to 24h. No background Stripe reconciliation schedule yet; billing-status retrieval refreshes and webhooks refresh. A configured price change requires re-attestation. Decide acceptable staleness and build monitored scheduled reconciliation before unattended operation.

Real local database evidence: PGlite runs PostgreSQL in-process with no hosted account or paid resources. Tests execute baseline and both new migrations; the unavailable pgcrypto extension declaration alone is omitted, since tested functions do not use it. Synthetic auth roles/users emulate needed interfaces. Tests execute quote RPC, cap three submitted calls, deny missing invitations/invalid plan, deny legacy RPC service-role use, and deny anon/authenticated access. This is actual SQL execution, not source-only inspection. PGlite serializes a single connection: Promise.all tests queued competing submissions, NOT independent concurrent database transactions or production Supabase behavior. Native postgres/psql/docker were unavailable. Staging multi-session concurrency, Auth integration, backup/restore and live grants still require proof.

51 local tests pass. Added .github/workflows/check.yml with read-only permissions, isolated npm ci/check and no deployment step; workflow has not run remotely because branch is not pushed.

Safe release sequence: resolve Vercel team access and Render trigger visibility; verify branch push cannot deploy production; push draft PR and run CI; apply both migrations to approved isolated staging; test concurrent transactions, Stripe test lifecycle/portal plan changes, browser owner/shop/history flow; independently review; take verified backups; obtain explicit production release authorization; coordinate migration/backend rollout and re-review/reattest pilot shops. Do not claim the ten-priority product is finished: photos/messages/status/disputes, Westchester boundary and remaining operational safeguards above still remain.

## Bounded reconciliation worker — implemented, not deployed
Supersedes the earlier missing-scheduler note. The existing long-running Express process now has an opt-in internal billing reconciliation timer; no public cron endpoint, URL secret, OS scheduler edit or hosting setting was added. Configure only after staging verification and all three pending migrations:
- BILLING_RECONCILIATION_ENABLED=true (default disabled; tests never start timer).
- BILLING_RECONCILIATION_INTERVAL_MINUTES=15 (integer 5–60).
- BILLING_RECONCILIATION_BATCH_SIZE=10 (integer 1–20).
- Existing Supabase service configuration and Stripe secret/shop price required; no new credentials.

Run on ONE persistent backend replica for the pilot. The timer runs once at startup, then each interval, skips overlapping runs, queries only the oldest due bounded batch, and retrieves Stripe subscriptions serially with 10-second timeout/no automatic retries. Refresh due after six hours, safely before 24h expiry. Canceled/incomplete_expired subscriptions do not consume recurring capacity. Full status/plan is re-derived from Stripe; matching customer/subscription identity required. Conditional database PATCH matches user, subscription and original updated_at, so stale work cannot overwrite a newer webhook/replacement. Count-only results are logged, not identities or secrets.

On retrieval failure, invalidate attestation and schedule retry at the configured interval; do not wait six hours or extend authorization. HTTP 429 stops the batch and honors Retry-After with at least one configured interval. Database failures log and retry on later ticks: if invalidation itself cannot persist, prior cache remains bounded by its existing 24h expiry. An unavailable/sleeping process does not run timers; free Render sleep means this is NOT a durable scheduler guarantee. Capacity and uptime must be monitored; one default worker processes at most 960 records/day, sufficient only for this bounded pilot. Multi-replica distributed claiming and alert delivery remain roadmap items.

Apply 20261021020000_reconciliation_and_quote_cents.sql after the other two pending migrations. It adds retry scheduling metadata and rejects fractional-cent quote amounts in the actual PostgreSQL RPC. Backend validation also rejects fractional cents. Health checks require the new retry column. No existing rows are deleted/reclassified and no production migration was run.

Independent reviews found and fixes address: six-hour lockout after transient refresh errors (separate retry time), terminal-subscription queue churn (excluded), malformed null Stripe item/price (safe invalid attestation), and 0.001 bids rounding to zero (reject sub-cent values). Database tests verify RPC rejection and compare-and-set stale-update protection. PGlite still does not prove independent multi-connection transactions.

Current access retry: Vercel now fails before project lookup because OAuth credentials expired. Previous actual 403 response required grant_team_access for ionqjays-projects and contained NO remediation URL; do not invent one. Reconnect Vercel with target-team authorization; tool error names openclaw mcp login vercel as the operator reauthentication command. Fresh catalog discovery still exposes no Render/Stripe service tools. Hosting trigger access remains required before branch push. No push, PR, deployment, live billing call, paid resource or user-account creation.

User access/authorization needed: reconnect Vercel for target team; provide Render read-only deployment-trigger visibility and isolated Stripe test-mode access; approve a separate staging database/migration plan and eventual release window. Independently implementable roadmap still includes photos, messaging, disputes/status UX, Westchester ZIP gating, rate-limit/admin audit hardening and browser/mobile QA. These are not blocked by Vercel login and are not claimed complete by this delivery.
