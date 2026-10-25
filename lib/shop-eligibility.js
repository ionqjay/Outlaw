// Only administrator-reviewed database records confer shop eligibility.
// User-editable Auth metadata and Stripe metadata are never business verification.
export function approvedShop(verification, userId) {
  return !!verification && String(verification.user_id) === String(userId)
    && verification.status === 'approved' && verification.business_type === 'registered_shop';
}
export function subscribedShop(verification, billing, userId, now = Date.now()) {
  return approvedShop(verification, userId)
    && String(billing?.user_id) === String(userId)
    && billing?.subscription_status === 'active'
    && !!billing.stripe_subscription_id
    && billing.shop_plan_valid === true
    && !!billing.shop_plan_price_id
    && Date.parse(billing.shop_plan_checked_at) <= now
    && Date.parse(billing.shop_plan_checked_at) > now - 24 * 60 * 60 * 1000
    && billing.manual_access_override !== 'disabled'
    && Number.isFinite(Date.parse(billing.current_period_end))
    && Date.parse(billing.current_period_end) > now;
}
