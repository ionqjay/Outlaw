import { attestShopPlan } from './stripe-entitlement.js';
import { subscriptionPeriodEnd } from './matching.js';
export function reconciliationConfig(env = {}) {
  const enabled = env.BILLING_RECONCILIATION_ENABLED === 'true';
  const intervalMinutes = Number(env.BILLING_RECONCILIATION_INTERVAL_MINUTES || 15);
  const batchSize = Number(env.BILLING_RECONCILIATION_BATCH_SIZE || 10);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 60
      || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw new Error('Invalid billing reconciliation bounds');
  return { enabled, intervalMs: intervalMinutes * 60000, batchSize };
}
// Dependencies are injected; tests never need Stripe or database credentials.
// listDue must query only the bounded oldest checked records, never a full account dump.
export function createBillingReconciler({ listDue, retrieve, save, priceId, config, clock = Date.now }) {
  let running = false;
  let retryAt = 0;
  return async function run() {
    if (!config.enabled || running || clock() < retryAt) return { skipped: true };
    running = true;
    const result = { processed: 0, failed: 0, rateLimited: false };
    try {
      const rows = await listDue(config.batchSize, new Date(clock() - 6 * 3600000).toISOString());
      for (const row of rows.slice(0, config.batchSize)) {
        let patch;
        try {
          const sub = await retrieve(row.stripe_subscription_id);
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
          if (sub.id !== row.stripe_subscription_id || !row.stripe_customer_id || customerId !== row.stripe_customer_id) throw new Error('Subscription identity mismatch');
          patch = { ...attestShopPlan(sub, priceId, clock()), subscription_status: String(sub.status || ''), current_period_end: subscriptionPeriodEnd(sub), cancel_at_period_end: !!sub.cancel_at_period_end };
        } catch (error) {
          // Failure revokes access, but retries at the worker interval rather than waiting six hours.
          patch = { shop_plan_valid: false, shop_plan_price_id: null, shop_plan_checked_at: null, billing_reconcile_after: new Date(clock() + config.intervalMs).toISOString() };
          result.failed++;
          if (error.statusCode === 429) {
            const seconds = Number(error.headers?.['retry-after']);
            retryAt = clock() + Math.max(config.intervalMs, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0);
            result.rateLimited = true;
            patch.billing_reconcile_after = new Date(retryAt).toISOString();
          }
        }
        if (!('billing_reconcile_after' in patch)) patch.billing_reconcile_after = null;
        // save must condition on the original subscription ID; never overwrite a replacement.
        await save(row, patch);
        result.processed++;
        if (result.rateLimited) break;
      }
      return result;
    } finally { running = false; }
  };
}
