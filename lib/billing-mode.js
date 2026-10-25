// Only explicit disabled relaxes Stripe requirements. Typos fail startup.
export function billingMode(env = {}) {
  const mode = env.BILLING_MODE || 'enabled';
  if (!['enabled', 'disabled'].includes(mode)) throw new Error('BILLING_MODE must be enabled or disabled');
  return mode;
}
export const BILLING_UNAVAILABLE = 'New repair requests, quotes and subscriptions are coming soon. Free accounts and existing repair history remain available. Billing management is unavailable in this app; contact support for existing subscriptions. Disabling the app does not cancel subscriptions.';
export function missingReleaseConfig(env = {}) {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CORS_ORIGINS', 'APP_URL', 'REPAIR_PHOTO_BUCKET'];
  if (billingMode(env) === 'enabled') required.push('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_SHOP_MONTHLY');
  return required.filter(key => !String(env[key] || '').trim());
}
