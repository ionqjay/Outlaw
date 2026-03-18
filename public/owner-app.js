const configuredApiBase = (window.APP_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');

const API_BASES = [
  configuredApiBase,
  location.origin,
  'https://outlaw-ba9s.onrender.com',
  'https://shopmyrepair-prelaunch.onrender.com',
  'https://shopmyrepair.onrender.com'
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

let workingApiBase = configuredApiBase || location.origin;
let selectedRequestId = null;
let repairsCache = [];
let bidsByRequest = new Map();
let pendingFeedback = null;
let pendingFeedbackStars = 0;
let comparePinned = [];
let feedbackCache = [];

function api(base, path) {
  return `${base}${path}`;
}

async function fetchJson(path, options = {}) {
  let lastErr = null;

  for (const base of API_BASES) {
    try {
      const res = await fetch(api(base, path), options);
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || 'Unexpected response' }; }

      if (!res.ok && (res.status === 404) && /route not found|not found/i.test(String(data?.error || data?.message || text))) {
        lastErr = new Error(`API route missing on ${base}`);
        continue;
      }

      workingApiBase = base;
      if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
      return data;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Unable to reach backend API.');
}

function setView(name) {
  ['home', 'dashboard', 'quote', 'profile'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    el.style.display = v === name ? 'block' : 'none';
  });

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

function setStatus(text, type = 'info') {
  const status = document.getElementById('ownerStatus');
  status.textContent = text;
  status.classList.remove('ok', 'err');
  if (type === 'ok') status.classList.add('ok');
  if (type === 'err') status.classList.add('err');
}

function labelForStatus(status) {
  const s = String(status || 'submitted').toLowerCase();
  if (s === 'open') return 'submitted';
  if (s === 'accepted') return 'accepted';
  if (s === 'in_progress') return 'in progress';
  if (s === 'completed') return 'completed';
  if (s === 'cancelled') return 'cancelled';
  return s;
}

function validateQuote() {
  const required = [
    ['title', 'Title'],
    ['issueCategory', 'Issue category'],
    ['issueDetails', 'Issue details'],
    ['vehicleYear', 'Vehicle year'],
    ['vehicleMake', 'Vehicle make'],
    ['vehicleModel', 'Vehicle model'],
    ['partsPreference', 'Parts preference'],
    ['city', 'City'],
    ['state', 'State'],
    ['zip', 'ZIP']
  ];

  for (const [id, label] of required) {
    const value = String(document.getElementById(id).value || '').trim();
    if (!value) throw new Error(`${label} is required.`);
  }
}

function parseBidNotes(notesRaw) {
  const txt = String(notesRaw || '');
  const m = txt.match(/\[META\](.*?)\[\/META\]/);
  if (!m) return { meta: null, notes: txt.trim() };
  try {
    const meta = JSON.parse(m[1]);
    const notes = txt.replace(m[0], '').trim();
    return { meta, notes };
  } catch {
    return { meta: null, notes: txt.trim() };
  }
}

function getFeedbacks() {
  if (Array.isArray(feedbackCache) && feedbackCache.length) return feedbackCache;
  return JSON.parse(localStorage.getItem('smr_feedback_v1') || '[]');
}

function saveFeedbacks(list) {
  feedbackCache = Array.isArray(list) ? list : [];
  localStorage.setItem('smr_feedback_v1', JSON.stringify(feedbackCache));
}

function getMechanicRating(mechanicId) {
  if (!mechanicId) return { avg: null, count: 0 };
  const rows = getFeedbacks().filter(x => String(x.mechanicId) === String(mechanicId));
  if (!rows.length) return { avg: null, count: 0 };
  const total = rows.reduce((s, x) => s + Number(x.rating || 0), 0);
  const avg = Math.round((total / rows.length) * 10) / 10;
  return { avg, count: rows.length };
}

async function recordFeedback({ requestId, bidId, mechanicId, rating, text, ownerId }) {
  const payload = {
    requestId,
    bidId,
    mechanicId,
    ownerId: ownerId || '',
    rating: Number(rating),
    text: String(text || '').trim()
  };

  const res = await fetchJson('/api/feedbacks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const row = res.feedback || {};
  const normalized = {
    requestId: Number(row.request_id || requestId),
    bidId: Number(row.bid_id || bidId),
    mechanicId: String(row.mechanic_id || mechanicId),
    rating: Number(row.rating || rating),
    text: String(row.text || text || ''),
    createdAt: row.created_at || new Date().toISOString()
  };

  const all = getFeedbacks();
  const idx = all.findIndex(x => String(x.requestId) === String(normalized.requestId));
  if (idx >= 0) all[idx] = normalized;
  else all.push(normalized);
  saveFeedbacks(all);
  return normalized;
}

function getFeedbackForRequest(requestId) {
  return getFeedbacks().find(x => String(x.requestId) === String(requestId)) || null;
}

function openFeedbackModal(payload) {
  pendingFeedback = payload;
  pendingFeedbackStars = 0;
  document.getElementById('feedbackNote').value = '';
  document.querySelectorAll('[data-star]').forEach(btn => btn.classList.remove('active'));
  document.getElementById('feedbackModal').classList.remove('hidden');
}

function closeFeedbackModal() {
  pendingFeedback = null;
  pendingFeedbackStars = 0;
  document.getElementById('feedbackModal').classList.add('hidden');
}

function renderRequests() {
  const reqWrap = document.getElementById('ownerRequests');

  if (!repairsCache.length) {
    reqWrap.innerHTML = "<div class='list-card'><strong>No requests yet.</strong><div class='muted-xs'>Post your first repair request to start receiving estimates.</div><button class='btn btn-orange' data-view='quote' style='margin-top:8px'>Post Repair Request</button></div>";
    return;
  }

  reqWrap.innerHTML = repairsCache.map(x => {
    const status = String(x.status || 'open').toLowerCase();
    const statusLabel = labelForStatus(status);
    const isSelected = Number(selectedRequestId) === Number(x.id);

    return `<div class='list-card'>
      <div class='request-head'>
        <strong>#${x.id} · ${x.title}</strong>
        <span class='pill ${status}'>${statusLabel}</span>
      </div>
      <div class='muted-xs'>${x.vehicle_year || ''} ${x.vehicle_make || ''} ${x.vehicle_model || ''} · ${x.city || ''}, ${x.state || ''}</div>
      <div class='muted-xs'>Next step: ${status === 'open' ? 'wait for bids' : status === 'accepted' ? 'coordinate service' : status === 'in_progress' ? 'service in progress' : status === 'completed' ? 'job completed' : 'review status'}.</div>
      <div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:8px'>
        <button class='btn btn-dark' data-view-request='${x.id}' style='padding:8px 12px'>${isSelected ? 'Viewing Repair Estimates' : 'View Repair Estimates'}</button>
        ${status === 'open' ? `<button class='btn btn-dark' data-cancel-request='${x.id}' style='padding:8px 12px;border-color:#7b3b3b;color:#ffb3b3'>Cancel Request</button>` : ''}
      </div>
    </div>`;
  }).join('');

  document.querySelectorAll('[data-view-request]').forEach(btn => btn.addEventListener('click', () => {
    selectedRequestId = Number(btn.dataset.viewRequest);
    renderRequests();
    renderBids();
  }));

  document.querySelectorAll('[data-cancel-request]').forEach(btn => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.cancelRequest);
    const ok = confirm('Cancel this request? This will decline open bids.');
    if (!ok) return;
    try {
      await fetchJson(`/api/repairs/${id}/cancel`, { method: 'POST' });
      await loadDashboardData(window.__ownerSession);
      renderRequests();
      renderBids();
    } catch (err) {
      alert(err.message || 'Could not cancel request.');
    }
  }));

  document.querySelectorAll('#ownerRequests [data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
}

function renderCompareTray(allBids = []) {
  const tray = document.getElementById('compareTray');
  const items = document.getElementById('compareItems');
  if (!tray || !items) return;

  if (!comparePinned.length) {
    tray.style.display = 'none';
    items.innerHTML = '';
    return;
  }

  const byId = new Map(allBids.map(b => [Number(b.id), b]));
  const cards = comparePinned
    .map(id => byId.get(Number(id)))
    .filter(Boolean)
    .map(b => `<span class='compare-pill'>#${b.id} · $${b.amount} · ${Number(b.eta_hours || 24)}h</span>`)
    .join('');
  tray.style.display = 'block';
  items.innerHTML = cards;
}

function renderBids() {
  const bidWrap = document.getElementById('ownerBids');

  if (!repairsCache.length) {
    bidWrap.innerHTML = '<p>—</p>';
    return;
  }

  const selected = repairsCache.find(r => Number(r.id) === Number(selectedRequestId)) || repairsCache[0];
  selectedRequestId = Number(selected.id);

  const bids = bidsByRequest.get(Number(selected.id)) || [];
  const accepted = bids.find(b => String(b.status || '').toLowerCase() === 'accepted');

  const header = `<div class='muted-xs' style='margin-bottom:8px'>Showing repair estimates for <b>Request #${selected.id}</b> — ${selected.title}</div>`;

  if (!bids.length) {
    bidWrap.innerHTML = `${header}<div class='list-card'><strong>No estimates yet.</strong><div class='muted-xs'>We are matching your request now. You can improve response quality by adding a little more detail.</div><button class='btn btn-dark' data-view='quote' style='margin-top:8px'>Update Request Details</button></div>`;
    document.querySelectorAll('#ownerBids [data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    return;
  }

  const openBids = bids.filter(b => String(b.status || '').toLowerCase() === 'open');
  const cheapestOpen = openBids.length ? Math.min(...openBids.map(b => Number(b.amount || 0))) : null;
  const fastestOpen = openBids.length ? Math.min(...openBids.map(b => Number(b.eta_hours || 999999))) : null;
  const topRatedOpen = openBids.length
    ? openBids.reduce((best, b) => {
        const rb = getMechanicRating(b.mechanic_id).avg || 0;
        const rbest = best ? (getMechanicRating(best.mechanic_id).avg || 0) : -1;
        return rb > rbest ? b : best;
      }, null)
    : null;

  const valueScore = (b) => {
    const amt = Number(b.amount || 0) || 1;
    const eta = Number(b.eta_hours || 24) || 24;
    const rating = getMechanicRating(b.mechanic_id).avg || 0;
    return (rating * 18) + (200 / eta) + (220 / amt);
  };
  const bestValueBid = openBids.length ? openBids.slice().sort((a, b) => valueScore(b) - valueScore(a))[0] : null;

  const cards = bids.map(b => {
    const status = String(b.status || 'open').toLowerCase();
    const parsed = parseBidNotes(b.notes);
    const meta = parsed.meta || {};
    const r = getMechanicRating(b.mechanic_id);
    const rating = r.avg ? `${r.avg}/5` : 'New';
    const reviewCount = `${r.count} review${r.count === 1 ? '' : 's'}`;
    const providerType = String(meta.providerType || '').toLowerCase() === 'shop' ? 'shop' : 'mechanic';
    const providerTypeLabel = meta.providerTypeLabel || (providerType === 'shop' ? 'Mechanic Shop' : 'Individual Mechanic');
    const tags = [];
    if (status === 'open' && cheapestOpen !== null && Number(b.amount || 0) === cheapestOpen) tags.push("<span class='tag best'>💸 Best Price</span>");
    if (status === 'open' && fastestOpen !== null && Number(b.eta_hours || 999999) === fastestOpen) tags.push("<span class='tag fast'>⚡ Fastest</span>");
    if (status === 'open' && topRatedOpen && Number(topRatedOpen.id) === Number(b.id) && (getMechanicRating(b.mechanic_id).avg || 0) > 0) tags.push("<span class='tag rated'>⭐ Top Rated</span>");
    if (status === 'open' && bestValueBid && Number(bestValueBid.id) === Number(b.id)) tags.push("<span class='tag rated'>🏆 Best Value</span>");

    return `<div class='estimate-card ${providerType}'>
      <div class='estimate-top'>
        <div>
          <div class='estimate-name'>${meta.businessName || b.mechanic_name}</div>
          <div class='provider-chip ${providerType}'>${providerType === 'shop' ? '🏪' : '🧰'} ${providerTypeLabel}</div>
        </div>
        <span class='pill ${status}'>${labelForStatus(status)}</span>
      </div>
      <div class='estimate-kpis'>
        <div class='kpi-pill'><div class='lbl'>Repair Estimate</div><div class='val'>$${b.amount}</div></div>
        <div class='kpi-pill'><div class='lbl'>ETA</div><div class='val small'>${Number(b.eta_hours || 24)}h</div></div>
      </div>
      <div class='badge-row'>${tags.join('')}</div>
      <div class='muted-xs'>📍 ${meta.businessAddress || 'Address not provided'} ${meta.businessZip || ''}</div>
      <div class='contact-row'>
        <span class='contact-pill'>📞 ${meta.businessPhone || 'No phone'}</span>
        <span class='contact-pill'>✉️ ${meta.businessEmail || 'No email'}</span>
        <span class='contact-pill'>⭐ ${rating} (${reviewCount})</span>
      </div>
      <div class='muted-xs'>Notes: ${parsed.notes ? parsed.notes : 'No additional notes provided.'}</div>
      <div class='muted-xs'><a href='/provider/${encodeURIComponent(b.mechanic_id)}' target='_blank' style='color:#9fc1ff'>View Provider Public Profile ↗</a></div>
      <div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:10px'>
        ${status === 'open' ? `<button class='btn btn-green' data-accept='${b.id}'>Accept Repair Estimate</button>` : ''}
        ${status === 'open' ? `<button class='btn btn-dark' data-pin='${b.id}'>${comparePinned.includes(Number(b.id)) ? 'Pinned' : 'Pin to Compare'}</button>` : ''}
      </div>
    </div>`;
  }).join('');

  const acceptedParsed = accepted ? parseBidNotes(accepted.notes) : null;
  const acceptedMeta = acceptedParsed?.meta || {};
  const acceptedRating = accepted ? getMechanicRating(accepted.mechanic_id) : { avg: null, count: 0 };
  const existingFeedback = accepted ? getFeedbackForRequest(selected.id) : null;
  const acceptedProviderType = String(acceptedMeta.providerType || '').toLowerCase() === 'shop' ? 'shop' : 'mechanic';
  const acceptedProviderTypeLabel = acceptedMeta.providerTypeLabel || (acceptedProviderType === 'shop' ? 'Mechanic Shop' : 'Individual Mechanic');
  const canComplete = String(selected.status || '').toLowerCase() === 'accepted' || String(selected.status || '').toLowerCase() === 'in_progress';
  const isCompleted = String(selected.status || '').toLowerCase() === 'completed';
  const acceptedAmount = accepted ? Number(accepted.amount || 0) : 0;
  const highestBid = bids.length ? Math.max(...bids.map(b => Number(b.amount || 0))) : acceptedAmount;
  const savings = Math.max(0, highestBid - acceptedAmount);
  const reason = accepted
    ? (bestValueBid && Number(bestValueBid.id) === Number(accepted.id)
      ? 'Best Value'
      : (fastestOpen !== null && Number(accepted.eta_hours || 999999) === Number(fastestOpen)
        ? 'Fastest ETA'
        : (topRatedOpen && Number(topRatedOpen.id) === Number(accepted.id)
          ? 'Top Rated'
          : 'Selected by you')))
    : '';
  const acceptedInfo = accepted ? `<div class='winner-shell estimate-card ${acceptedProviderType}' style='border-color:#2a9f60;box-shadow:0 0 0 1px rgba(42,159,96,.18) inset'>
    <div class='winner-hero'>
      <div>
        <div class='winner-title'>✅ Selected Estimate</div>
        <div class='estimate-name'>${acceptedMeta.businessName || accepted.mechanic_name}</div>
        <div class='provider-chip ${acceptedProviderType}'>${acceptedProviderType === 'shop' ? '🏪' : '🧰'} ${acceptedProviderTypeLabel}</div>
      </div>
      <span class='pill accepted'>accepted</span>
    </div>

    <div class='winner-kpi-grid'>
      <div class='kpi-pill'><div class='lbl'>Final Price</div><div class='val'>$${accepted.amount}</div></div>
      <div class='kpi-pill'><div class='lbl'>ETA</div><div class='val small'>${Number(accepted.eta_hours || 24)}h</div></div>
      <div class='kpi-pill'><div class='lbl'>Why Selected</div><div class='val small'>${reason}</div></div>
      <div class='kpi-pill'><div class='lbl'>Savings vs Highest</div><div class='val small'>$${savings}</div></div>
    </div>

    <div class='winner-timeline'>
      <span class='done'>Requested</span>
      <span class='done'>Estimates</span>
      <span class='done'>Accepted</span>
      <span class='${isCompleted ? 'done' : 'current'}'>${isCompleted ? 'Completed' : 'In Progress'}</span>
    </div>

    <div class='badge-row'><span class='tag rated'>✅ Selected Provider</span><span class='tag best'>${reason}</span></div>
    <div class='muted-xs'>📍 ${acceptedMeta.businessAddress || 'Address not provided'} ${acceptedMeta.businessZip || ''}</div>
    <div class='contact-row'>
      <span class='contact-pill'>📞 ${acceptedMeta.businessPhone || 'No phone'}</span>
      <span class='contact-pill'>✉️ ${acceptedMeta.businessEmail || 'No email'}</span>
      <span class='contact-pill'>⭐ ${acceptedRating.avg ? `${acceptedRating.avg}/5` : 'New'} (${acceptedRating.count} review${acceptedRating.count === 1 ? '' : 's'})</span>
    </div>
    <div class='muted-xs'>Scope: ${acceptedParsed?.notes ? acceptedParsed.notes : 'No additional scope notes provided.'}</div>
    <div class='muted-xs'><a href='/provider/${encodeURIComponent(accepted.mechanic_id)}' target='_blank' style='color:#9fc1ff'>View Provider Public Profile ↗</a></div>
    ${existingFeedback ? `<div class='muted-xs'>✅ Your review was submitted: <b>${existingFeedback.rating}/5</b>${existingFeedback.text ? ` — ${existingFeedback.text}` : ''}</div>` : ''}

    <div class='winner-actions'>
      ${canComplete ? `<button class='btn btn-green' data-complete='${selected.id}'>Mark Job Completed</button>` : ''}
      ${isCompleted ? `<button class='btn btn-dark' data-feedback='${accepted.id}' data-request='${selected.id}' data-mechanic='${accepted.mechanic_id}'>${existingFeedback ? 'Update Review' : 'Leave Feedback'}</button>` : `<span class='muted-xs'>Review unlocks after job is marked completed.</span>`}
    </div>
  </div>` : '';

  bidWrap.innerHTML = `${header}${acceptedInfo}${cards}`;
  renderCompareTray(bids);

  document.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await fetchJson(`/api/bids/${btn.dataset.accept}/accept`, { method: 'POST' });
      await loadDashboardData(window.__ownerSession);
      renderRequests();
      renderBids();
    } catch (err) {
      alert(err.message || 'Could not accept bid.');
    }
  }));

  document.querySelectorAll('[data-pin]').forEach(btn => btn.addEventListener('click', () => {
    const id = Number(btn.dataset.pin);
    if (comparePinned.includes(id)) comparePinned = comparePinned.filter(x => x !== id);
    else {
      comparePinned = [id, ...comparePinned.filter(x => x !== id)].slice(0, 3);
    }
    renderBids();
  }));

  document.querySelectorAll('[data-feedback]').forEach(btn => btn.addEventListener('click', () => {
    const requestId = Number(btn.dataset.request);
    const existing = getFeedbackForRequest(requestId);
    openFeedbackModal({
      requestId,
      bidId: Number(btn.dataset.feedback),
      mechanicId: btn.dataset.mechanic
    });
    if (existing) {
      pendingFeedbackStars = Number(existing.rating || 0);
      document.getElementById('feedbackNote').value = existing.text || '';
      document.querySelectorAll('[data-star]').forEach(s => s.classList.toggle('active', Number(s.dataset.star) <= pendingFeedbackStars));
    }
  }));

  document.querySelectorAll('[data-complete]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await fetchJson(`/api/repairs/${btn.dataset.complete}/complete`, { method: 'POST' });
      await loadDashboardData(window.__ownerSession);
      renderRequests();
      renderBids();
      alert('Job marked as completed ✅ You can now leave a review.');
    } catch (err) {
      alert(err.message || 'Could not mark job completed.');
    }
  }));
}

async function loadDashboardData(session) {
  window.__ownerSession = session;
  const data = await fetchJson(`/api/repairs?ownerId=${encodeURIComponent(session.id)}`);
  repairsCache = data.repairs || [];

  if (!repairsCache.length) {
    selectedRequestId = null;
    bidsByRequest = new Map();
    return;
  }

  if (!selectedRequestId || !repairsCache.find(r => Number(r.id) === Number(selectedRequestId))) {
    selectedRequestId = Number(repairsCache[0].id);
  }

  const entries = await Promise.all(repairsCache.map(async (rep) => {
    const bd = await fetchJson(`/api/bids?requestId=${rep.id}`);
    return [Number(rep.id), bd.bids || []];
  }));
  bidsByRequest = new Map(entries);

  try {
    const fb = await fetchJson('/api/feedbacks');
    const normalized = (fb.feedbacks || []).map(x => ({
      requestId: Number(x.request_id || x.requestId),
      bidId: Number(x.bid_id || x.bidId),
      mechanicId: String(x.mechanic_id || x.mechanicId || ''),
      rating: Number(x.rating || 0),
      text: String(x.text || ''),
      createdAt: x.created_at || x.createdAt || ''
    }));
    saveFeedbacks(normalized);
  } catch {}

}

function renderOwnerChecklist({ allBids = [] } = {}) {
  const el = document.getElementById('ownerChecklist');
  if (!el) return;

  const profile = {
    name: String(document.getElementById('profileName')?.value || '').trim(),
    email: String(document.getElementById('profileEmail')?.value || '').trim(),
    phone: String(document.getElementById('profilePhone')?.value || '').trim()
  };
  const profileDone = !!(profile.name && profile.email && profile.phone);
  const postedRequest = repairsCache.length > 0;
  const reviewedEstimate = allBids.length > 0;

  const doneCount = [profileDone, postedRequest, reviewedEstimate].filter(Boolean).length;
  el.innerHTML = `
    <div class='muted-xs'>Progress: <b>${doneCount}/3 complete</b></div>
    <div class='muted-xs'>${profileDone ? '✅' : '⬜'} Complete profile (name, email, phone)</div>
    <div class='muted-xs'>${postedRequest ? '✅' : '⬜'} Post your first repair request</div>
    <div class='muted-xs'>${reviewedEstimate ? '✅' : '⬜'} Review your first estimate</div>
  `;
}

function renderHomeSummary() {
  const allBids = Array.from(bidsByRequest.values()).flat();
  const openRequests = repairsCache.filter(r => String(r.status || '').toLowerCase() === 'open').length;
  renderOwnerChecklist({ allBids });
  const acceptedJobs = repairsCache.filter(r => ['accepted', 'in_progress', 'completed'].includes(String(r.status || '').toLowerCase())).length;
  const newEstimates = allBids.filter(b => String(b.status || '').toLowerCase() === 'open').length;
  const avgEstimate = allBids.length ? Math.round(allBids.reduce((s, b) => s + Number(b.amount || 0), 0) / allBids.length) : 0;

  const openEl = document.getElementById('homeOpenRequests');
  const newEl = document.getElementById('homeNewEstimates');
  const acceptedEl = document.getElementById('homeAcceptedJobs');
  const avgEl = document.getElementById('homeAvgEstimate');
  if (openEl) openEl.textContent = String(openRequests);
  if (newEl) newEl.textContent = String(newEstimates);
  if (acceptedEl) acceptedEl.textContent = String(acceptedJobs);
  if (avgEl) avgEl.textContent = `$${avgEstimate}`;

  const statusEl = document.getElementById('homeStatus');
  if (statusEl) {
    if (!repairsCache.length) statusEl.textContent = 'No active repair requests yet.';
    else if (newEstimates > 0) statusEl.textContent = `You have ${openRequests} open request(s) and ${newEstimates} repair estimate(s) waiting for review.`;
    else statusEl.textContent = `You have ${openRequests} open request(s). Next step: monitor new repair estimates.`;
  }

  const topEl = document.getElementById('homeTopEstimates');
  if (topEl) {
    const top = allBids
      .filter(b => String(b.status || '').toLowerCase() === 'open')
      .sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0))
      .slice(0, 2)
      .map(b => {
        const parsed = parseBidNotes(b.notes);
        const meta = parsed.meta || {};
        const r = getMechanicRating(b.mechanic_id);
        const providerTypeLabel = meta.providerTypeLabel || (String(meta.providerType || '').toLowerCase() === 'shop' ? 'Mechanic Shop' : 'Individual Mechanic');
        return `<div class='muted-xs'>${meta.businessName || b.mechanic_name} (${providerTypeLabel}): <b>$${b.amount}</b> · ${r.avg ? `${r.avg}/5` : 'No rating yet'} (${r.count})</div>`;
      });
    topEl.innerHTML = top.length ? top.join('') : 'No estimates to review yet.';
  }

  const recentEl = document.getElementById('homeRecentActivity');
  if (recentEl) {
    const recent = allBids.slice(0, 4).map(b => {
      const st = String(b.status || 'open').toLowerCase();
      if (st === 'accepted') return `✅ You accepted an estimate from ${b.mechanic_name}.`;
      if (st === 'open') return `🕒 New estimate received from ${b.mechanic_name}.`;
      return `ℹ️ Estimate ${st} from ${b.mechanic_name}.`;
    });
    recentEl.innerHTML = recent.length ? recent.map(x => `<div class='muted-xs'>${x}</div>`).join('') : 'No recent activity yet.';
  }
}

async function boot() {
  const session = await window.smrAuth.requireRole('owner');
  if (!session) return;

  document.getElementById('logoutBtn').addEventListener('click', () => window.smrAuth.logoutToLogin());

  document.getElementById('feedbackOverlay').addEventListener('click', closeFeedbackModal);
  document.getElementById('feedbackCancelBtn').addEventListener('click', closeFeedbackModal);
  document.querySelectorAll('[data-star]').forEach(btn => btn.addEventListener('click', () => {
    pendingFeedbackStars = Number(btn.dataset.star);
    document.querySelectorAll('[data-star]').forEach(s => s.classList.toggle('active', Number(s.dataset.star) <= pendingFeedbackStars));
  }));
  document.getElementById('feedbackSubmitBtn').addEventListener('click', async () => {
    if (!pendingFeedback) return;
    if (!Number.isFinite(pendingFeedbackStars) || pendingFeedbackStars < 1 || pendingFeedbackStars > 5) {
      alert('Please select a star rating from 1 to 5.');
      return;
    }
    const text = document.getElementById('feedbackNote').value || '';

    try {
      await recordFeedback({
        requestId: pendingFeedback.requestId,
        bidId: pendingFeedback.bidId,
        mechanicId: pendingFeedback.mechanicId,
        ownerId: window.__ownerSession?.id || '',
        rating: pendingFeedbackStars,
        text
      });

      closeFeedbackModal();
      await loadDashboardData(window.__ownerSession);
      renderBids();
      alert('Review submitted successfully ✅');
    } catch (err) {
      alert(err.message || 'Could not submit review.');
    }
  });

  async function loadProfile() {
    const profile = await window.smrAuth.getOwnerProfile();
    if (!profile) return;
    document.getElementById('profileName').value = profile.name || '';
    document.getElementById('profileEmail').value = profile.email || '';
    document.getElementById('profilePhone').value = profile.phone || '';
    document.getElementById('profileCity').value = profile.city || '';
    document.getElementById('profileState').value = profile.state || 'NY';
    document.getElementById('profileZip').value = profile.zip || '';

    if (!document.getElementById('city').value && profile.city) document.getElementById('city').value = profile.city;
    if (!document.getElementById('state').value && profile.state) document.getElementById('state').value = profile.state;
    if (!document.getElementById('zip').value && profile.zip) document.getElementById('zip').value = profile.zip;
  }

  async function refreshDashboard() {
    const reqWrap = document.getElementById('ownerRequests');
    const bidWrap = document.getElementById('ownerBids');
    reqWrap.innerHTML = "<div class='skeleton'></div><div class='skeleton'></div>";
    bidWrap.innerHTML = "<div class='skeleton'></div><div class='skeleton'></div>";

    try {
      await loadDashboardData(session);
      renderHomeSummary();
      renderRequests();
      renderBids();
    } catch (err) {
      reqWrap.innerHTML = `<p style='color:#ff9a9a'>${err.message || 'Could not load dashboard.'}</p>`;
      bidWrap.innerHTML = '<p>—</p>';
    }
  }

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const profileStatus = document.getElementById('profileStatus');
    profileStatus.classList.remove('ok', 'err');
    profileStatus.textContent = 'Saving profile...';

    try {
      await window.smrAuth.saveOwnerProfile({
        name: document.getElementById('profileName').value,
        email: document.getElementById('profileEmail').value,
        phone: document.getElementById('profilePhone').value,
        city: document.getElementById('profileCity').value,
        state: document.getElementById('profileState').value,
        zip: document.getElementById('profileZip').value
      });
      profileStatus.textContent = 'Profile updated successfully.';
      profileStatus.classList.add('ok');
      await loadProfile();
    } catch (err) {
      profileStatus.textContent = err.message || 'Could not update profile.';
      profileStatus.classList.add('err');
    }
  });

  document.getElementById('submitRepairBtn').addEventListener('click', async () => {
    try {
      validateQuote();
    } catch (err) {
      setStatus(err.message || 'Please check required fields.', 'err');
      return;
    }

    const partsPreference = document.getElementById('partsPreference').value;
    const partsLabel = partsPreference === 'owner-brings-parts'
      ? 'Owner will bring parts'
      : 'Mechanic/shop should provide parts';

    const ownerEmail = (document.getElementById('profileEmail').value || session.email || '').trim();
    const ownerPhone = (document.getElementById('profilePhone').value || '').trim();
    const ownerMeta = `[OWNER_META]${JSON.stringify({ ownerEmail, ownerPhone })}[/OWNER_META]`;

    const payload = {
      ownerId: session.id,
      title: document.getElementById('title').value.trim(),
      issueCategory: document.getElementById('issueCategory').value,
      issueDetails: `${ownerMeta} [Parts preference: ${partsLabel}] ${document.getElementById('issueDetails').value.trim()}`,
      vehicleYear: document.getElementById('vehicleYear').value.trim(),
      vehicleMake: document.getElementById('vehicleMake').value.trim(),
      vehicleModel: document.getElementById('vehicleModel').value.trim(),
      city: document.getElementById('city').value.trim(),
      state: document.getElementById('state').value.trim(),
      zip: document.getElementById('zip').value.trim(),
      urgency: document.getElementById('urgency').value
    };

    const btn = document.getElementById('submitRepairBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    setStatus('Submitting your request...');

    try {
      await fetchJson('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      setStatus('Request submitted successfully.', 'ok');
      ['title','issueDetails','vehicleYear','vehicleMake','vehicleModel','city','zip'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('issueCategory').value = '';
      document.getElementById('urgency').value = 'Standard';
      document.getElementById('partsPreference').value = '';
      setView('dashboard');
      await refreshDashboard();
    } catch (err) {
      setStatus(`${err.message || 'Failed to submit request.'} (Tried: ${API_BASES.join(', ')})`, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Repair Request';
    }
  });

  await loadProfile();
  refreshDashboard();
}

boot();
