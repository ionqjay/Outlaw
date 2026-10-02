import { createHash } from 'node:crypto';

export const FAIRNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const INITIAL_INVITE_LIMITS = Object.freeze({ shop: 3 });

export function providerKey(provider) {
  return `${String(provider.email || provider.provider_email || '').trim().toLowerCase()}:${provider.providerType || provider.provider_type}`;
}

// Rank only already-eligible providers. Recent opportunity count is primary;
// response history and distance only break ties. New providers start at 50%.
export function rankInviteCandidates(providers, history, repair, now = Date.now()) {
  const stats = new Map();
  const seen = new Set();
  for (const invite of history) {
    const created = Date.parse(invite.created_at);
    if (!Number.isFinite(created) || created < now - FAIRNESS_WINDOW_MS || created > now) continue;
    const key = providerKey(invite);
    const eventKey = `${invite.repair_id}:${key}`;
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    const stat = stats.get(key) || { count: 0, submitted: 0, expired: 0, last: 0 };
    stat.count++;
    stat.last = Math.max(stat.last, created);
    if (invite.status === 'submitted') stat.submitted++;
    else if (invite.status === 'expired' || (invite.status === 'pending' && Date.parse(invite.expires_at) <= now)) stat.expired++;
    stats.set(key, stat);
  }
  const unique = new Map(providers.map(provider => [providerKey(provider), provider]));
  return [...unique.values()].map(provider => {
    const key = providerKey(provider);
    const stat = stats.get(key) || { count: 0, submitted: 0, expired: 0, last: 0 };
    const responseRate = (stat.submitted + 2) / (stat.submitted + stat.expired + 4);
    const miles = Number.isFinite(provider.distanceMiles) ? Math.max(0, provider.distanceMiles) : Infinity;
    const proximity = Math.max(0, 1 - miles / 100);
    const quality = 0.6 * responseRate + 0.4 * proximity;
    const tie = createHash('sha256').update(`${repair.id || repair.Id}:${key}`).digest('hex');
    return { provider, stat, quality, tie };
  }).sort((a, b) => a.stat.count - b.stat.count
    || b.quality - a.quality
    || a.stat.last - b.stat.last
    || a.tie.localeCompare(b.tie))
    .map(entry => entry.provider);
}

export function initialInviteCandidates(ranked) {
  return Object.entries(INITIAL_INVITE_LIMITS).flatMap(([type, limit]) =>
    ranked.filter(provider => provider.providerType === type).slice(0, limit));
}

// Serializes read/select/write dispatch work within one Node process.
// Multiple backend replicas still require a shared database lock/queue.
export function createDispatchQueue() {
  let tail = Promise.resolve();
  return work => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
}
