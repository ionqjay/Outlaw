# Billing-disabled release

Set server **BILLING_MODE=disabled** and **BILLING_RECONCILIATION_ENABLED=false**. The second setting is defense in depth; disabled mode overrides a previously enabled worker. Missing BILLING_MODE defaults to enabled, preserving existing behavior; invalid values abort startup. No client setting grants access.

Keep NODE_ENV=production, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL, CORS_ORIGINS and REPAIR_PHOTO_BUCKET configured. APP_URL is the canonical app URL; CORS_ORIGINS must include the deployed frontend origin(s). REPAIR_PHOTO_BUCKET must name an existing private bucket. Preserve existing security/proxy configuration. Do not enable ALLOW_DEV_AUTH. Stripe secret/webhook/shop-price values are not required in disabled mode and are never used to construct a client even if retained.

## Preconditions / release proof
- Apply/review existing repository migrations including admin membership/audit, private photos, workflow/messages, registered shops and entitlement fields. This change adds no migration and provisions no administrator.
- Verify existing private bucket and service-role permissions. Health still probes required database columns and private storage readiness; disabled does not waive these checks.
- Deploy matching frontend and backend. Verify GET /api/health returns 200 with billingMode=disabled, databaseReady=true, stripeConfigured=false, stripeBillingReady=false. Verify /api/availability announces coming soon, checkout/new requests/new quotes fail 503, and an authenticated historical participant can access only their existing jobs/messages/photos/status.
- Verify owner, shop, pricing and landing pages show unavailable/coming-soon state; account creation/login remain free. No real checkout or charge is needed for proof.

## Existing subscriptions and webhooks
Disabling this application DOES NOT cancel, pause, refund or change any live Stripe subscription. The app blocks checkout, portal, live invoice retrieval, refund submission/processing and administrative billing changes. Stored subscription status is historical, not proof of current entitlement; existing refund records remain readable. No fake paid access or mock cancellation is performed.

Before releasing, the operator must assess existing subscribers and provide a monitored support path. An authorized operator can inspect/manage an existing subscription directly in the Stripe Dashboard, after verifying customer identity and obtaining the required authorization for any change. Do not tell customers that app disablement stops their charges.

Webhooks return 503 (not a false acknowledgment); Stripe may retry and eventually expire deliveries. No event changes local billing state while disabled. When billing returns, reconcile against authoritative Stripe subscription state and review/replay missed deliveries safely; never blindly repeat uncertain billing writes.

## Rollback / re-enable
Prefer rolling forward with BILLING_MODE=disabled for UI/code fixes. An older release does not understand this gate: do not roll back to older code while relying on the disabled variable for safety. Keep traffic closed if an older version must be restored until its billing configuration and access behavior are verified.

Re-enable only with operator approval, all three Stripe settings (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_SHOP_MONTHLY), verified recurring $99 USD monthly price, working webhook, and refreshed entitlement reconciliation. Set BILLING_MODE=enabled and deliberately choose worker settings. Confirm health and eligibility before reopening new requests. No database rollback or deletion is required for this release.
