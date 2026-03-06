async function getActiveSession() {
  if (window.smrSupabaseReady && window.smrSupabase) {
    const { data } = await window.smrSupabase.auth.getSession();
    const s = data?.session;
    if (!s?.user) return null;
    const role = s.user.user_metadata?.role || localStorage.getItem('smr_role') || '';
    const name = s.user.user_metadata?.name || '';
    const phone = s.user.user_metadata?.phone || '';
    const city = s.user.user_metadata?.city || '';
    const state = s.user.user_metadata?.state || '';
    const zip = s.user.user_metadata?.zip || '';
    return { id: s.user.id, email: s.user.email || '', role, name, phone, city, state, zip };
  }
  const local = JSON.parse(localStorage.getItem('smr_session') || 'null');
  return local;
}

async function requireRole(requiredRole) {
  const session = await getActiveSession();
  if (!session?.id || session.role !== requiredRole) {
    window.location.href = '/login.html';
    return null;
  }
  return session;
}

async function saveOwnerProfile(profile = {}) {
  const session = await getActiveSession();
  if (!session?.id) throw new Error('No active session.');

  const clean = {
    name: String(profile.name || '').trim(),
    phone: String(profile.phone || '').trim(),
    city: String(profile.city || '').trim(),
    state: String(profile.state || '').trim(),
    zip: String(profile.zip || '').trim()
  };

  localStorage.setItem(`smr_owner_profile_${session.id}`, JSON.stringify(clean));

  if (window.smrSupabaseReady && window.smrSupabase) {
    await window.smrSupabase.auth.updateUser({ data: clean });
  }

  return clean;
}

async function getOwnerProfile() {
  const session = await getActiveSession();
  if (!session?.id) return null;

  const local = JSON.parse(localStorage.getItem(`smr_owner_profile_${session.id}`) || '{}');
  const merged = {
    name: session.name || local.name || '',
    phone: session.phone || local.phone || '',
    city: session.city || local.city || '',
    state: session.state || local.state || 'NY',
    zip: session.zip || local.zip || ''
  };

  return merged;
}

async function logoutToLogin() {
  if (window.smrSupabaseReady && window.smrSupabase) {
    await window.smrSupabase.auth.signOut();
  }
  localStorage.removeItem('smr_session');
  localStorage.removeItem('smr_role');
  window.location.href = '/login.html';
}

window.smrAuth = { getActiveSession, requireRole, saveOwnerProfile, getOwnerProfile, logoutToLogin };
