import http from 'node:http';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const build = process.env.RENDER_GIT_COMMIT || 'shopmyrepair-maintenance-bridge-v1';
const server = http.createServer((req, res) => {
  // Compare the raw path, without normalizing encoded slashes or dot segments.
  const rawPath = String(req.url || '').split('?')[0];
  const ready = ['GET', 'HEAD'].includes(req.method) && rawPath === '/api/health';
  res.writeHead(ready ? 200 : 503, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Retry-After': '120',
    'X-Content-Type-Options': 'nosniff',
    'Connection': 'close'
  });
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
    maintenance: true, build,
    ...(ready ? { ready: true } : { error: 'Service temporarily unavailable for maintenance.' })
  }));
});
server.on('checkContinue', (req, res) => { server.emit('request', req, res); });
server.on('connect', (_req, socket) => { socket.end('HTTP/1.1 503 Service Unavailable\r\nCache-Control: no-store\r\nRetry-After: 120\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
server.on('upgrade', (_req, socket) => { socket.end('HTTP/1.1 503 Service Unavailable\r\nCache-Control: no-store\r\nRetry-After: 120\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 503 Service Unavailable\r\nCache-Control: no-store\r\nRetry-After: 120\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ maintenance: true, port: server.address().port, build })));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
