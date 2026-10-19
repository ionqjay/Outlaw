import fs from 'node:fs';
import path from 'node:path';

export function operationsStore({ database, request, directory }) {
  const allowed = new Set(['notifications', 'opportunity_events', 'refund_requests', 'provider_verifications']);
  function file(table) {
    if (!allowed.has(table)) throw new Error('Invalid operations table');
    return path.join(directory, `${table}.json`);
  }
  async function list(table, filters = {}) {
    file(table);
    if (database) {
      const query = new URLSearchParams({ select: '*', order: 'created_at.desc', ...Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, `eq.${value}`])) });
      return request(`${table}?${query}`);
    }
    const rows = fs.existsSync(file(table)) ? JSON.parse(fs.readFileSync(file(table), 'utf8')) : [];
    return rows.filter(row => Object.entries(filters).every(([key, value]) => String(row[key]) === String(value)));
  }
  async function save(table, row, conflict = 'id', ignore = false) {
    file(table);
    if (database) {
      const rows = await request(`${table}?on_conflict=${encodeURIComponent(conflict)}`, {
        method: 'POST', body: row,
        prefer: `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=representation`
      });
      return rows[0] || null;
    }
    const rows = await list(table);
    const keys = conflict.split(',');
    const index = rows.findIndex(item => keys.every(key => row[key] !== undefined && String(item[key]) === String(row[key])));
    if (index >= 0 && ignore) return rows[index];
    const next = { id: index >= 0 ? rows[index].id : Math.max(0, ...rows.map(x => Number(x.id) || 0)) + 1, created_at: new Date().toISOString(), ...(index >= 0 ? rows[index] : {}), ...row };
    if (index >= 0) rows[index] = next; else rows.unshift(next);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file(table), JSON.stringify(rows, null, 2));
    return next;
  }
  return { list, save };
}

export function registerOperations({ route, store, requireUser, guardAdmin, billingFor, stripe, request }) {
  async function invoicePeriod(invoice) {
    const line = invoice?.lines?.data?.find(item => item.period && (item.type === 'subscription' || item.parent?.type === 'subscription_item_details'));
    return line?.period || null;
  }

  async function billingInvoiceContext(user, invoiceId) {
    const billing = await billingFor(user.id);
    if (!stripe || !billing?.stripe_customer_id) return { errorStatus: 409, error: 'No billed subscription was found.' };
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const customer = typeof invoice?.customer === 'string' ? invoice.customer : invoice?.customer?.id;
    if (customer !== billing.stripe_customer_id) return { errorStatus: 404, error: 'Invoice not found.' };
    const subId = invoice.subscription || invoice.parent?.subscription_details?.subscription;
    if (!subId || String(subId) !== String(billing.stripe_subscription_id) || invoice.status !== 'paid' || invoice.amount_paid <= 0) {
      return { errorStatus: 400, error: 'This invoice is not a paid marketplace subscription.' };
    }
    const period = await invoicePeriod(invoice);
    if (!period) return { errorStatus: 409, error: 'Contact support to review this invoice period.' };
    return { billing, invoice, period };
  }

  route('get', '/api/notifications', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const rows = await store.list('notifications', { user_id: user.id });
    res.json({ ok: true, notifications: rows.slice(0, 50) });
  });
  route('post', '/api/notifications/:id/read', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const row = (await store.list('notifications', { user_id: user.id })).find(x => String(x.id) === req.params.id);
    if (!row) return res.status(404).json({ error: 'Notification not found.' });
    await store.save('notifications', { ...row, read_at: new Date().toISOString() });
    res.json({ ok: true });
  });
  route('get', '/api/provider/verification', async (req, res) => {
    const user = await requireUser(req, res, ['mechanic', 'shop']); if (!user) return;
    res.json({ ok: true, verification: (await store.list('provider_verifications', { user_id: user.id }))[0] || null });
  });
  route('post', '/api/provider/verification', async (req, res) => {
    const user = await requireUser(req, res, ['mechanic', 'shop']); if (!user) return;
    const previous = (await store.list('provider_verifications', { user_id: user.id }))[0];
    if (previous?.status === 'approved') return res.status(409).json({ error: 'Your profile has already been reviewed. Contact support for changes.' });
    const fields = ['business_name', 'license_reference', 'insurance_reference'];
    if (fields.some(key => !String(req.body?.[key] || '').trim() || String(req.body[key]).length > 500)) return res.status(400).json({ error: 'Enter a business name, license reference, and insurance reference (maximum 500 characters each).' });
    const row = await store.save('provider_verifications', {
      user_id: user.id, ...Object.fromEntries(fields.map(key => [key, String(req.body[key]).trim()])),
      status: 'pending', review_note: null, updated_at: new Date().toISOString()
    }, 'user_id');
    res.json({ ok: true, verification: row });
  });
  route('get', '/api/billing/refund-requests', async (req, res) => {
    const user = await requireUser(req, res, ['mechanic', 'shop']); if (!user) return;
    res.json({ ok: true, requests: await store.list('refund_requests', { user_id: user.id }) });
  });
  route('get', '/api/billing/invoices', async (req, res) => {
    const user = await requireUser(req, res, ['mechanic', 'shop']); if (!user) return;
    const billing = await billingFor(user.id);
    if (!stripe || !billing?.stripe_customer_id) return res.json({ ok: true, invoices: [] });
    const [stripeInvoices, refundRequests] = await Promise.all([
      stripe.invoices.list({ customer: billing.stripe_customer_id, status: 'paid', limit: 24 }),
      store.list('refund_requests', { user_id: user.id })
    ]);
    const invoices = [];
    for (const invoice of stripeInvoices?.data || []) {
      const subId = invoice.subscription || invoice.parent?.subscription_details?.subscription;
      if (String(subId || '') !== String(billing.stripe_subscription_id || '')) continue;
      const period = await invoicePeriod(invoice);
      if (!period || invoice.amount_paid <= 0) continue;
      const refund = refundRequests.find(row => String(row.invoice_id) === String(invoice.id));
      invoices.push({
        id: invoice.id,
        amount_paid: invoice.amount_paid,
        currency: invoice.currency,
        created: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
        period_start: new Date(period.start * 1000).toISOString(),
        period_end: new Date(period.end * 1000).toISOString(),
        refund_status: refund?.stripe_refund_id && refund?.status !== 'refunded' ? 'submitted' : (refund?.status || null),
        refund_request_id: refund?.id || null
      });
    }
    res.json({ ok: true, invoices });
  });
  route('post', '/api/billing/refund-requests', async (req, res) => {
    const user = await requireUser(req, res, ['mechanic', 'shop']); if (!user) return;
    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!/^in_[A-Za-z0-9]+$/.test(invoiceId)) return res.status(400).json({ error: 'Enter the invoice ID from your Stripe billing portal.' });
    const context = await billingInvoiceContext(user, invoiceId);
    if (context.error) return res.status(context.errorStatus).json({ error: context.error });
    const { invoice, period: { start, end } } = context;
    if (end * 1000 > Date.now()) return res.status(409).json({ error: 'You can request a guarantee review after the billing period ends.' });
    const existing = (await store.list('refund_requests', { invoice_id: invoiceId }))[0];
    if (existing) return res.json({ ok: true, request: existing });
    const opportunities = await store.list('opportunity_events', { provider_email: user.email.toLowerCase() });
    const count = opportunities.filter(x => new Date(x.created_at).getTime() >= start * 1000 && new Date(x.created_at).getTime() < end * 1000).length;
    const row = await store.save('refund_requests', {
      user_id: user.id, invoice_id: invoiceId, amount_paid: invoice.amount_paid, currency: invoice.currency,
      period_start: new Date(start * 1000).toISOString(), period_end: new Date(end * 1000).toISOString(),
      opportunity_count: count, status: 'pending', review_note: 'Review eligibility and historical coverage before approving. Older periods may predate opportunity tracking.'
    }, 'invoice_id', true);
    res.json({ ok: true, request: row });
  });
  route('get', '/api/admin/launch', async (req, res) => {
    if (guardAdmin(req, res)) return;
    const [refunds, verifications] = await Promise.all([store.list('refund_requests'), store.list('provider_verifications')]);
    res.json({ ok: true, refunds, verifications });
  });
  route('post', '/api/admin/verification/:userId', async (req, res) => {
    if (guardAdmin(req, res)) return;
    const row = (await store.list('provider_verifications', { user_id: req.params.userId }))[0];
    const status = req.body?.status;
    if (!row || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Select a valid application and review decision.' });
    const note = String(req.body?.note || '').trim();
    if (note.length < 5 || note.length > 2000) return res.status(400).json({ error: 'Record the verification evidence or rejection reason.' });
    await store.save('provider_verifications', { ...row, status, review_note: note, updated_at: new Date().toISOString() }, 'user_id');
    res.json({ ok: true });
  });
  route('post', '/api/admin/refund/:id/review', async (req, res) => {
    if (guardAdmin(req, res)) return;
    const row = (await store.list('refund_requests')).find(x => String(x.id) === req.params.id);
    const status = req.body?.status;
    if (!row || row.status === 'refunded' || row.stripe_refund_id || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid refund review.' });
    const note = String(req.body?.note || '').trim();
    if (note.length < 5 || note.length > 2000) return res.status(400).json({ error: 'Record the eligibility evidence and review decision.' });
    await store.save('refund_requests', { ...row, status, review_note: note, updated_at: new Date().toISOString() });
    res.json({ ok: true });
  });
  route('post', '/api/admin/refund/:id/process', async (req, res) => {
    if (guardAdmin(req, res)) return;
    const row = (await store.list('refund_requests')).find(x => String(x.id) === req.params.id);
    if (row?.status === 'refunded') return res.json({ ok: true });
    if (!stripe || row?.status !== 'approved') return res.status(409).json({ error: 'Approve the refund after reviewing eligibility first.' });
    const invoice = await stripe.invoices.retrieve(row.invoice_id, { expand: ['payments'] });
    const payment = invoice.payment_intent || invoice.payments?.data?.find(x => x.status === 'paid')?.payment?.payment_intent;
    const paymentIntent = typeof payment === 'string' ? payment : payment?.id;
    if (!paymentIntent) return res.status(409).json({ error: 'Review the payment in Stripe; automatic refund is unavailable for this invoice.' });
    const refund = row.stripe_refund_id
      ? await stripe.refunds.retrieve(row.stripe_refund_id)
      : await stripe.refunds.create({ payment_intent: paymentIntent, amount: row.amount_paid, metadata: { request_id: String(row.id) } }, { idempotencyKey: `opportunity-refund:${row.invoice_id}` });
    await store.save('refund_requests', { ...row, stripe_refund_id: refund.id, updated_at: new Date().toISOString() });
    if (refund.status !== 'succeeded') return res.status(409).json({ error: `Stripe refund status: ${refund.status}. Review it in Stripe before taking further action.` });
    await store.save('refund_requests', { ...row, status: 'refunded', stripe_refund_id: refund.id, updated_at: new Date().toISOString() });
    res.json({ ok: true });
  });
}
