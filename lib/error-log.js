// Route patterns are application-owned; request paths, messages, bodies and
// arbitrary error names may contain personal data or credentials.
export function requestFailureSummary(req, error) {
  const method = ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method) ? req.method : 'OTHER';
  const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
  const category = ['TypeError','SyntaxError','AbortError','TimeoutError'].includes(error?.name) ? error.name : 'Error';
  return { method, route, category };
}
