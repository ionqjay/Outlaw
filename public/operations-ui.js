(() => {
  const base = (window.APP_CONFIG?.API_BASE || location.origin).replace(/\/$/, '');
  async function api(url, body) {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...await window.smrAuth.getAuthHeaders() }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  async function notifications() {
    const panel = document.getElementById('notificationsList');
    if (!panel) return;
    try {
      const data = await api('/api/notifications');
      panel.replaceChildren();
      if (!data.notifications.length) { panel.textContent = 'New invitations, estimates, and job updates will appear here.'; return; }
      for (const item of data.notifications.slice(0, 10)) {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.href = ['/owner-app.html', '/mechanic.html'].includes(item.href) ? item.href : '#';
        link.textContent = `${item.read_at ? '' : 'New: '}${item.title}`;
        link.addEventListener('click', () => { api(`/api/notifications/${item.id}/read`, {}).catch(() => {}); });
        const body = document.createElement('p'); body.textContent = item.body;
        row.append(link, body); panel.append(row);
      }
    } catch (error) { panel.textContent = error.message; }
  }
  async function verificationStatus() {
    const status = document.getElementById('verificationStatus');
    if (!status) return;
    try {
      const { verification } = await api('/api/provider/verification');
      status.textContent = verification ? `Review: ${verification.status}. ${verification.review_note || ''}` : 'Submit your business details for a manual review. Approval is not a guarantee of repair quality.';
    } catch (error) { status.textContent = error.message; }
  }
  document.getElementById('verificationForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('verificationStatus');
    const button = event.target.querySelector('button'); button.disabled = true;
    try {
      await api('/api/provider/verification', Object.fromEntries(new FormData(event.target)));
      await verificationStatus();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.getElementById('refundForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('refundStatus');
    const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const data = await api('/api/billing/refund-requests', Object.fromEntries(new FormData(event.target)));
      status.textContent = `Request #${data.request.id}: ${data.request.status}. Your billing period and eligible opportunities will be reviewed.`;
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  window.smrAuth.getActiveSession().then(session => { if (session) { notifications(); verificationStatus(); } });
  setInterval(() => { if (!document.hidden) notifications(); }, 60000);
})();
