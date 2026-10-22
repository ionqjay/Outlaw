(() => {
  let generation=0;
  function clearQueues(){document.getElementById('verificationQueue').replaceChildren();document.getElementById('refundQueue').replaceChildren();}
  const status = document.getElementById('opsStatus');
  const base = (window.APP_CONFIG?.API_BASE || location.origin).replace(/\/$/, '');
  async function api(url, body) {
    const current=generation;
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...await window.smrAuth.getAuthHeaders() }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if(current!==generation)throw Error('Session changed; reload to reauthorize.');
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  function addButton(card, label, callback) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-secondary'; button.textContent = label;
    button.addEventListener('click', async () => { button.disabled = true; try { await callback(); await load(); } catch (error) { clearQueues(); status.textContent = error.message; } finally { button.disabled = false; } });
    card.append(button);
  }
  function cardFor(queue, text) { const card = document.createElement('div'); card.className = 'list-card'; const description = document.createElement('p'); description.textContent = text; card.append(description); queue.append(card); return card; }
  async function load() {
    generation++;clearQueues();
    const data = await api('/api/admin/launch');
    const verificationQueue = document.getElementById('verificationQueue'); verificationQueue.replaceChildren();
    for (const row of data.verifications) {
      const card = cardFor(verificationQueue, `${row.business_name} — ${row.status}. Registration: ${row.registration_reference || "missing"}. Address: ${row.business_address || "missing"}. License reference: ${row.license_reference}. Insurance reference: ${row.insurance_reference}. ${row.review_note || ''}`);
      for (const decision of ['approved', 'rejected']) addButton(card, decision === 'approved' ? 'Approve review' : 'Reject review', async () => { const note = prompt('Record your verification evidence or rejection reason:'); if (!note) return; await api(`/api/admin/verification/${encodeURIComponent(row.user_id)}`, { status: decision, note }); });
    }
    const refundQueue = document.getElementById('refundQueue'); refundQueue.replaceChildren();
    for (const row of data.refunds) {
      const card = cardFor(refundQueue, `#${row.id} — ${row.invoice_id} — ${(row.amount_paid / 100).toFixed(2)} ${row.currency.toUpperCase()} — ${row.status}. Period: ${row.period_start} to ${row.period_end}. Recorded opportunities: ${row.opportunity_count}. ${row.review_note || ''}`);
      if (row.status !== 'refunded') for (const decision of ['approved', 'rejected']) addButton(card, decision === 'approved' ? 'Approve refund' : 'Reject refund', async () => { const note = prompt('Record your eligibility evidence and decision:'); if (!note) return; await api(`/api/admin/refund/${row.id}/review`, { status: decision, note }); });
      if (row.status === 'approved') addButton(card, 'Process Stripe refund', async () => { if (!confirm(`Refund ${(row.amount_paid / 100).toFixed(2)} ${row.currency.toUpperCase()} for ${row.invoice_id}?`)) return; await api(`/api/admin/refund/${row.id}/process`, {}); });
    }
    status.textContent = `Loaded ${data.verifications.length} provider reviews and ${data.refunds.length} refund requests.`;
  }
  window.smrSupabase?.auth?.onAuthStateChange(event=>{if(['SIGNED_OUT','SIGNED_IN','USER_UPDATED'].includes(event)){generation++;clearQueues();status.textContent='Session changed; reload to reauthorize.';}});
  document.getElementById('adminLogin').addEventListener('submit', async event => { event.preventDefault(); try { await load(); } catch (error) { clearQueues(); status.textContent = error.message; } });
})();
