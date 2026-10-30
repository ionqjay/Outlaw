// A response deadline is separate from work settlement: never overlap a stuck probe.
// Timers cannot bound event-loop stalls, network startup or proxy latency.
export function singleFlightProbe(probe, { ttlMs = 5000, timeoutMs = 3000, clock = Date.now } = {}) {
  let pending = null, expiresAt = 0, result;
  return function check() {
    if (pending) return pending;
    if (clock() < expiresAt) return Promise.resolve(result);
    const controller = new AbortController();
    let responded = false, resolveResponse;
    pending = new Promise(resolve => { resolveResponse = resolve; });
    const response = pending;
    const finish = value => {
      if (responded) return;
      responded = true;
      result = value;
      expiresAt = clock() + ttlMs;
      resolveResponse(value);
    };
    const timer = setTimeout(() => {
      finish(false);
      controller.abort();
      // Keep pending (now resolved false) until work settles, even past cache TTL.
    }, timeoutMs);
    Promise.resolve().then(() => probe(controller.signal)).then(Boolean).catch(() => false).then(value => {
      clearTimeout(timer);
      finish(value); // A late success cannot overwrite timeout failure.
      pending = null;
    });
    return response;
  };
}
