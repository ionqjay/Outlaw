// Input must come from a server-side Stripe subscription retrieval, never client metadata.
export function attestShopPlan(subscription, expectedPriceId, now = Date.now()) {
  const items = subscription?.items;
  const item = items?.data?.[0];
  const price = item?.price;
  const valid = !!expectedPriceId && items?.has_more !== true && items?.data?.length === 1
    && item.quantity === 1 && typeof price === 'object' && price.id === expectedPriceId
    && price.currency === 'usd' && price.unit_amount === 9900
    && price.recurring?.interval === 'month' && price.recurring?.interval_count === 1;
  return { shop_plan_valid: valid, shop_plan_price_id: valid ? price.id : null,
    shop_plan_checked_at: new Date(now).toISOString() };
}
