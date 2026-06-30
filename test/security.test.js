import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_AUTH = 'true';

const { app, sanitizeRepairForUser, sanitizeBidForUser } = await import('../server.js');

function listen() {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withServer(fn) {
  const server = await listen();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('marketplace routes require authentication', async () => {
  await withServer(async base => {
    const repairs = await fetch(`${base}/api/repairs`);
    assert.equal(repairs.status, 401);

    const bids = await fetch(`${base}/api/bids`);
    assert.equal(bids.status, 401);

    const feedbacks = await fetch(`${base}/api/feedbacks`);
    assert.equal(feedbacks.status, 401);
  });
});

test('repair sanitizer strips owner contact metadata for providers', () => {
  const provider = { id: 'provider-1', email: 'provider@example.com', user_metadata: { role: 'mechanic' } };
  const repair = {
    id: 1,
    owner_id: 'owner-1',
    title: 'Brake job',
    issue_details: '[OWNER_META]{"ownerEmail":"owner@example.com","ownerPhone":"5551234567"}[/OWNER_META] Pads and rotors',
    vehicle_year: '2020',
    vehicle_make: 'BMW',
    vehicle_model: '430i',
    city: 'Dobbs Ferry',
    state: 'NY',
    zip: '10522',
    status: 'open'
  };

  const out = sanitizeRepairForUser(repair, provider);
  assert.equal(out.issue_details, 'Pads and rotors');
  assert.equal(out.zip, '105xx');
  assert.equal(JSON.stringify(out).includes('owner@example.com'), false);
  assert.equal(JSON.stringify(out).includes('5551234567'), false);
});

test('bid sanitizer strips provider private metadata unless explicitly allowed', () => {
  const owner = { id: 'owner-1', email: 'owner@example.com', user_metadata: { role: 'owner' } };
  const bid = {
    id: 1,
    request_id: 2,
    mechanic_id: 'provider-1',
    mechanic_name: 'Fast Brakes',
    amount: 300,
    eta_hours: 24,
    notes: '[META]{"businessName":"Fast Brakes","businessEmail":"shop@example.com","businessPhone":"5559990000"}[/META] We can do this tomorrow.',
    status: 'open'
  };

  const publicOut = sanitizeBidForUser(bid, owner);
  assert.equal(publicOut.notes, 'We can do this tomorrow.');
  assert.equal(JSON.stringify(publicOut).includes('shop@example.com'), false);
  assert.equal(JSON.stringify(publicOut).includes('5559990000'), false);

  const authorizedOut = sanitizeBidForUser(bid, owner, { includeProviderContact: true });
  assert.equal(authorizedOut.provider.businessEmail, 'shop@example.com');
  assert.equal(authorizedOut.provider.businessPhone, '5559990000');
});
