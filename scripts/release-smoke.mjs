// Explicit target only. GET-only, no credentials, redirects, retries or scheduling.
import { pathToFileURL } from 'node:url';

export function targetOrigin(value) {
  if (!value) throw new Error('Usage: node scripts/release-smoke.mjs <explicit-origin>');
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Provide an origin only, without credentials/path/query');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('HTTPS required except localhost');
  return u.origin;
}

export async function smoke(origin, { fetchImpl = fetch, timeoutMs = 90000 } = {}) {
  origin = targetOrigin(origin);
  const results = [];
  for (const path of ['/api/health', '/API/HEALTH', '/api/availability']) {
    const start = Date.now();
    try {
      const response = await fetchImpl(origin + path, { method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
      const body = await response.json();
      const noStore = /(?:^|,)\s*no-store(?:\s*[,;]|$)/i.test(response.headers.get('cache-control') || '');
      const contract = path.toLowerCase().endsWith('/health')
        ? body.ok === true && body.databaseReady === true && body.billingMode === 'disabled'
        : body.billingMode === 'disabled' && body.newQuotesAvailable === false;
      // Do not output response bodies, configuration names or arbitrary exception text.
      results.push({ path, status: response.status, durationMs: Date.now() - start, noStore, contract, pass: response.status === 200 && noStore && contract });
    } catch {
      results.push({ path, durationMs: Date.now() - start, pass: false, error: 'request-or-json-failed' });
    }
  }
  return { checkedAt: new Date().toISOString(), origin, pass: results.every(r => r.pass), results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/release-smoke.mjs <explicit-origin>');
    const result = await smoke(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
