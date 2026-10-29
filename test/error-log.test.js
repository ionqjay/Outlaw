import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFailureSummary } from '../lib/error-log.js';
test('error summary retains route template but never caller path, values or arbitrary error names', () => {
  const summary = requestFailureSummary({ method:'POST', path:'/api/admin/verification/private@example.test', route:{path:'/api/admin/verification/:id'}, body:{password:'secret'}, headers:{authorization:'secret'} }, { name:'private@example.test', message:'secret', stack:'secret' });
  assert.deepEqual(summary, { method:'POST', route:'/api/admin/verification/:id', category:'Error' });
  assert.doesNotMatch(JSON.stringify(summary), /private|secret/);
  assert.deepEqual(requestFailureSummary({method:'PRIVATE',path:'/secret'}, {name:'TimeoutError'}), {method:'OTHER',route:'unmatched',category:'TimeoutError'});
});
