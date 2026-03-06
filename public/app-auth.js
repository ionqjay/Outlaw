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
    const contactEmail = s.user.user_metadata?.email || '';
    return { id: s.user.id, email: s.user.email || '', contactEmail, role, name, phone, city, state, zip };
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
    email: String(profile.email || '').trim(),
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
    name: local.name || session.name || '',
    email: local.email || session.contactEmail || session.email || '',
    phone: local.phone || session.phone || '',
    city: local.city || session.city || '',
    state: local.state || session.state || 'NY',
    zip: local.zip || session.zip || ''
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

async function saveMechanicProfile(profile = {}) {
  const session = await getActiveSession();
  if (!session?.id) throw new Error('No active session.');

  const clean = {
    businessName: String(profile.businessName || '').trim(),
    businessAddress: String(profile.businessAddress || '').trim(),
    name: String(profile.name || '').trim(),
    email: String(profile.email || '').trim(),
    phone: String(profile.phone || '').trim(),
    city: String(profile.city || '').trim(),
    state: String(profile.state || '').trim(),
    zip: String(profile.zip || '').trim(),
    services: String(profile.services || '').trim()
  };

  localStorage.setItem(`smr_mechanic_profile_${session.id}`, JSON.stringify(clean));

  if (window.smrSupabaseReady && window.smrSupabase) {
    await window.smrSupabase.auth.updateUser({ data: clean });
  }

  return clean;
}

async function getMechanicProfile() {
  const session = await getActiveSession();
  if (!session?.id) return null;

  const local = JSON.parse(localStorage.getItem(`smr_mechanic_profile_${session.id}`) || '{}');
  return {
    businessName: local.businessName || '',
    businessAddress: local.businessAddress || '',
    name: local.name || session.name || '',
    email: local.email || session.contactEmail || session.email || '',
    phone: local.phone || session.phone || '',
    city: local.city || session.city || '',
    state: local.state || session.state || 'NY',
    zip: local.zip || session.zip || '',
    services: local.services || ''
  };
}

window.smrAuth = { getActiveSession, requireRole, saveOwnerProfile, getOwnerProfile, saveMechanicProfile, getMechanicProfile, logoutToLogin };
