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

test('manual billing override controls estimate access', async () => {
  const billingAccountsPath = new URL('../billing_accounts.json', import.meta.url);

  await preservingJsonFiles([billingAccountsPath], async () => {
    fs.writeFileSync(billingAccountsPath, JSON.stringify([
      {
        user_id: 'mechanic-manual-active-1',
        email: 'manual-active@example.com',
        role: 'mechanic',
        subscription_status: 'none',
        manual_access_override: 'active'
      },
      {
        user_id: 'mechanic-manual-disabled-1',
        email: 'manual-disabled@example.com',
        role: 'mechanic',
        stripe_customer_id: 'cus_test_disabled',
        stripe_subscription_id: 'sub_test_disabled',
        subscription_status: 'active',
        manual_access_override: 'disabled'
      }
    ], null, 2));

    await withServer(async base => {
      const active = await fetch(`${base}/api/billing/status`, {
        headers: {
          'x-dev-user-id': 'mechanic-manual-active-1',
          'x-dev-user-email': 'manual-active@example.com',
          'x-dev-user-role': 'mechanic'
        }
      });
      assert.equal(active.status, 200);
      const activeData = await active.json();
      assert.equal(activeData.canSubmitEstimates, true);
      assert.equal(activeData.manualAccessOverride, 'active');

      const disabled = await fetch(`${base}/api/billing/status`, {
        headers: {
          'x-dev-user-id': 'mechanic-manual-disabled-1',
          'x-dev-user-email': 'manual-disabled@example.com',
          'x-dev-user-role': 'mechanic'
        }
      });
      assert.equal(disabled.status, 200);
      const disabledData = await disabled.json();
      assert.equal(disabledData.hasSubscription, true);
      assert.equal(disabledData.canSubmitEstimates, false);
      assert.equal(disabledData.manualAccessOverride, 'disabled');
    });
  });
});

test('owners cannot view bids for another owner repair', async () => {
  const repairRequestsPath = new URL('../repair_requests.json', import.meta.url);
  const bidsPath = new URL('../bids.json', import.meta.url);

  await preservingJsonFiles([repairRequestsPath, bidsPath], async () => {
    fs.writeFileSync(repairRequestsPath, JSON.stringify([
      {
        id: 101,
        owner_id: 'owner-private-1',
        title: 'Private brake request',
        issue_details: 'Brake pedal vibration',
        vehicle_year: '2021',
        vehicle_make: 'Honda',
        vehicle_model: 'Accord',
        city: 'Yonkers',
        state: 'NY',
        zip: '10701',
        status: 'open',
        created_at: new Date().toISOString()
      }
    ], null, 2));
    fs.writeFileSync(bidsPath, JSON.stringify([
      {
        id: 201,
        request_id: 101,
        mechanic_id: 'mechanic-private-1',
        mechanic_name: 'Private Shop',
        amount: 425,
        eta_hours: 24,
        notes: '[META]{"businessName":"Private Shop","businessEmail":"provider@example.com","businessPhone":"5551230000"}[/META] Pads and rotors included.',
        status: 'open',
        created_at: new Date().toISOString()
      }
    ], null, 2));

    await withServer(async base => {
      const res = await fetch(`${base}/api/bids?requestId=101`, {
        headers: {
          'x-dev-user-id': 'owner-private-2',
          'x-dev-user-email': 'other-owner@example.com',
          'x-dev-user-role': 'owner'
        }
      });

      assert.equal(res.status, 403);
    });
  });
});

test('paid invited provider can submit estimate and owner can accept completed review flow', async () => {
  const repairRequestsPath = new URL('../repair_requests.json', import.meta.url);
  const bidsPath = new URL('../bids.json', import.meta.url);
  const billingAccountsPath = new URL('../billing_accounts.json', import.meta.url);
  const requestInvitesPath = new URL('../request_invites.json', import.meta.url);
  const feedbacksPath = new URL('../feedbacks.json', import.meta.url);

  await preservingJsonFiles([repairRequestsPath, bidsPath, billingAccountsPath, requestInvitesPath, feedbacksPath], async () => {
    fs.writeFileSync(repairRequestsPath, JSON.stringify([
      {
        id: 301,
        owner_id: 'owner-paid-loop-1',
        title: 'Front brake repair',
        issue_category: 'brakes',
        issue_details: 'Pads are worn and rotor is grinding',
        vehicle_year: '2019',
        vehicle_make: 'Toyota',
        vehicle_model: 'RAV4',
        city: 'Yonkers',
        state: 'NY',
        zip: '10701',
        urgency: 'Standard',
        status: 'open',
        created_at: new Date().toISOString()
      }
    ], null, 2));
    fs.writeFileSync(bidsPath, JSON.stringify([], null, 2));
    fs.writeFileSync(feedbacksPath, JSON.stringify([], null, 2));
    fs.writeFileSync(billingAccountsPath, JSON.stringify([
      {
        user_id: 'mechanic-paid-loop-1',
        email: 'paid-loop@example.com',
        role: 'mechanic',
        stripe_customer_id: 'cus_paid_loop',
        stripe_subscription_id: 'sub_paid_loop',
        subscription_status: 'active'
      }
    ], null, 2));
    fs.writeFileSync(requestInvitesPath, JSON.stringify([
      {
        repair_id: 301,
        provider_email: 'paid-loop@example.com',
        provider_type: 'mechanic',
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        submitted_at: null
      }
    ], null, 2));

    await withServer(async base => {
      const mechanicHeaders = {
        'Content-Type': 'application/json',
        'x-dev-user-id': 'mechanic-paid-loop-1',
        'x-dev-user-email': 'paid-loop@example.com',
        'x-dev-user-role': 'mechanic'
      };
      const ownerHeaders = {
        'Content-Type': 'application/json',
        'x-dev-user-id': 'owner-paid-loop-1',
        'x-dev-user-email': 'owner-paid-loop@example.com',
        'x-dev-user-role': 'owner'
      };

      const feed = await fetch(`${base}/api/repairs`, { headers: mechanicHeaders });
      assert.equal(feed.status, 200);
      const feedData = await feed.json();
      assert.equal(feedData.repairs.length, 1);
      assert.equal(feedData.repairs[0].id, 301);

      const bid = await fetch(`${base}/api/bids`, {
        method: 'POST',
        headers: mechanicHeaders,
        body: JSON.stringify({
          requestId: 301,
          mechanicName: 'Paid Loop Mechanic',
          amount: 375,
          etaHours: 24,
          notes: '[META]{"providerType":"mechanic","businessName":"Paid Loop Mechanic","businessEmail":"paid-loop@example.com","businessPhone":"5551234567"}[/META] Pads and rotors included with same-day diagnostics.'
        })
      });
      assert.equal(bid.status, 200);
      const bidData = await bid.json();
      assert.equal(bidData.ok, true);
      assert.equal(bidData.bid.amount, 375);

      const ownerBids = await fetch(`${base}/api/bids?requestId=301`, { headers: ownerHeaders });
      assert.equal(ownerBids.status, 200);
      const ownerBidsData = await ownerBids.json();
      assert.equal(ownerBidsData.bids.length, 1);
      assert.equal(ownerBidsData.bids[0].provider.businessEmail, 'paid-loop@example.com');

      const accept = await fetch(`${base}/api/bids/${bidData.bid.id}/accept`, {
        method: 'POST',
        headers: ownerHeaders
      });
      assert.equal(accept.status, 200);

      const complete = await fetch(`${base}/api/repairs/301/complete`, {
        method: 'POST',
        headers: ownerHeaders
      });
      assert.equal(complete.status, 200);

      const feedback = await fetch(`${base}/api/feedbacks`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          requestId: 301,
          bidId: bidData.bid.id,
          rating: 5,
          text: 'Fast response and clear estimate.'
        })
      });
      assert.equal(feedback.status, 200);
      const feedbackData = await feedback.json();
      assert.equal(feedbackData.ok, true);
      assert.equal(feedbackData.feedback.rating, 5);
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
