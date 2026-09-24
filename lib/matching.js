import zipcodes from 'zipcodes';

export function validZip(value) {
  const zip = String(value || '').trim();
  return /^\d{5}$/.test(zip) && zipcodes.lookup(zip)?.country === 'US';
}

// ZIP-centroid distance is an estimate, not a driving-distance promise.
export function withinServiceArea(provider, repair) {
  if (!validZip(provider?.zip) || !validZip(repair?.zip)) return false;
  const radius = Number(provider.serviceRadiusMiles);
  if (!Number.isFinite(radius) || radius < 1 || radius > 100) return false;
  const miles = zipcodes.distance(provider.zip, repair.zip);
  return Number.isFinite(miles) && miles <= radius;
}

export function trustedRole(user) {
  const role = String(user?.app_metadata?.role || '').toLowerCase();
  if (['owner', 'mechanic', 'shop', 'admin'].includes(role)) return role;
  // Self-selected marketplace roles confer no administrative permissions.
  const selected = String(user?.user_metadata?.role || '').toLowerCase();
  return ['owner', 'mechanic', 'shop'].includes(selected) ? selected : '';
}

export function subscriptionPeriodEnd(subscription) {
  const ts = subscription?.current_period_end || subscription?.items?.data?.[0]?.current_period_end;
  return ts ? new Date(Number(ts) * 1000).toISOString() : null;
}
