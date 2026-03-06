async function getActiveSession() {
  if (window.smrSupabaseReady && window.smrSupabase) {
    const { data } = await window.smrSupabase.auth.getSession();
    const s = data?.session;
    if (!s?.user) return null;
    const role = s.user.user_metadata?.role || localStorage.getItem('smr_role') || '';
    const name = s.user.user_metadata?.name || '';
    return { id: s.user.id, email: s.user.email || '', role, name };
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

async function logoutToLogin() {
  if (window.smrSupabaseReady && window.smrSupabase) {
    await window.smrSupabase.auth.signOut();
  }
  localStorage.removeItem('smr_session');
  localStorage.removeItem('smr_role');
  window.location.href = '/login.html';
}

window.smrAuth = { getActiveSession, requireRole, logoutToLogin };
