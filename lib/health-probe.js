// Bounds public health-check amplification without masking failures for a long TTL.
// The supplied I/O must itself have deadlines (server dependency calls use 10s).
export function singleFlightProbe(probe, { ttlMs = 5000, clock = Date.now } = {}) {
  let pending = null, expiresAt = 0, result;
  return function check() {
    if (pending) return pending;
    if (clock() < expiresAt) return Promise.resolve(result);
    pending = Promise.resolve().then(probe).then(Boolean).catch(() => false).then(value => {
      result = value;
      expiresAt = clock() + ttlMs;
      pending = null;
      return value;
    });
    return pending;
  };
}
