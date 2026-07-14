import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

async function preservingJsonFiles(paths, fn) {
  const snapshots = new Map(paths.map(filePath => [
    filePath,
    fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
  ]));
  try {
    await fn();
  } finally {
    for (const [filePath, contents] of snapshots.entries()) {
      if (contents === null) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } else {
        fs.writeFileSync(filePath, contents);
      }
    }
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

test('Render-hosted origins can reach marketplace routes', async () => {
  await withServer(async base => {
    const origin = 'https://outlaw-ba9s.onrender.com';

    const preflight = await fetch(`${base}/api/repairs`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);

    const repairs = await fetch(`${base}/api/repairs`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    assert.equal(repairs.status, 401);
    assert.equal(repairs.headers.get('access-control-allow-origin'), origin);
  });
});

test('repair submission client request id is idempotent', async () => {
  const repairRequestsPath = new URL('../repair_requests.json', import.meta.url);
  const requestInvitesPath = new URL('../request_invites.json', import.meta.url);

  await preservingJsonFiles([repairRequestsPath, requestInvitesPath], async () => {
    await withServer(async base => {
      const payload = {
        title: 'Brake noise',
        issueCategory: 'brakes',
        issueDetails: '[OWNER_META]{"ownerEmail":"owner@example.com"}[/OWNER_META] Squeaking front brakes',
        vehicleYear: '2020',
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        city: 'Yonkers',
        state: 'NY',
        zip: '10701',
        urgency: 'Standard',
        clientRequestId: 'test-client-request-1'
      };
      const headers = {
        'Content-Type': 'application/json',
        'x-dev-user-id': 'owner-idempotent-1',
        'x-dev-user-email': 'owner@example.com',
        'x-dev-user-role': 'owner'
      };

      const first = await fetch(`${base}/api/repairs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      assert.equal(first.status, 200);
      const firstData = await first.json();
      assert.equal(firstData.ok, true);
      assert.equal(firstData.duplicate, undefined);

      const second = await fetch(`${base}/api/repairs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      assert.equal(second.status, 200);
      const secondData = await second.json();
      assert.equal(secondData.ok, true);
      assert.equal(secondData.duplicate, true);
      assert.equal(secondData.repair.id, firstData.repair.id);
      assert.equal(secondData.repair.issue_details.includes('CLIENT_META'), false);
      assert.equal(secondData.repair.issue_details, 'Squeaking front brakes');
    });
  });
});

test('mechanic billing status reports portal availability', async () => {
  const billingAccountsPath = new URL('../billing_accounts.json', import.meta.url);

  await preservingJsonFiles([billingAccountsPath], async () => {
    await withServer(async base => {
      const res = await fetch(`${base}/api/billing/status`, {
        headers: {
          'x-dev-user-id': 'mechanic-no-billing-1',
          'x-dev-user-email': 'mechanic@example.com',
          'x-dev-user-role': 'mechanic'
        }
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.hasSubscription, false);
      assert.equal(data.hasStripeCustomer, false);
      assert.equal(data.canSubmitEstimates, false);
    });
  });
});

test('mechanic billing status allows active billing access', async () => {
  const billingAccountsPath = new URL('../billing_accounts.json', import.meta.url);

  await preservingJsonFiles([billingAccountsPath], async () => {
    fs.writeFileSync(billingAccountsPath, JSON.stringify([
      {
        user_id: 'mechanic-active-billing-1',
        email: 'mechanic-active@example.com',
        role: 'mechanic',
        stripe_customer_id: 'cus_test_active',
        stripe_subscription_id: 'sub_test_active',
        subscription_status: 'active'
      }
    ], null, 2));

    await withServer(async base => {
      const res = await fetch(`${base}/api/billing/status`, {
        headers: {
          'x-dev-user-id': 'mechanic-active-billing-1',
          'x-dev-user-email': 'mechanic-active@example.com',
          'x-dev-user-role': 'mechanic'
        }
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.hasStripeCustomer, true);
      assert.equal(data.status, 'active');
      assert.equal(data.canSubmitEstimates, true);
    });
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
  assert.equal(authorizedOut.mechanic_id, 'provider-1');
  assert.equal(authorizedOut.provider.businessEmail, 'shop@example.com');
  assert.equal(authorizedOut.provider.businessPhone, '5559990000');
});
