function setLocalSession({ email, role, name }) {
  const id = btoa(String(email).toLowerCase()).replace(/=+$/, '');
  localStorage.setItem('smr_session', JSON.stringify({ id, email, role, name: name || '' }));
  localStorage.setItem('smr_role', role);
  return { id, email, role, name: name || '' };
}
function getUsers() { return JSON.parse(localStorage.getItem('smr_users') || '[]'); }
function saveUsers(users) { localStorage.setItem('smr_users', JSON.stringify(users)); }
function go(role) { window.location.href = role === 'mechanic' ? '/mechanic.html' : '/owner-app.html'; }

const statusEl = document.getElementById('authStatus');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');

function values() {
  return {
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim().toLowerCase(),
    password: document.getElementById('password').value,
    role: document.getElementById('role').value
  };
}

async function signUpSupabase({ name, email, password, role }) {
  const { data, error } = await window.smrSupabase.auth.signUp({
    email,
    password,
    options: { data: { role, name } }
  });
  if (error) throw error;
  const user = data?.user;
  if (!user) throw new Error('Could not create account.');
  localStorage.setItem('smr_role', role);
  if (!data.session) {
    statusEl.textContent = 'Account created. Check your email to confirm, then sign in.';
    return;
  }
  go(role);
}

async function signInSupabase({ email, password }) {
  const { data, error } = await window.smrSupabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const role = data?.user?.user_metadata?.role || localStorage.getItem('smr_role') || 'owner';
  localStorage.setItem('smr_role', role);
  go(role);
}

signUpBtn.addEventListener('click', async () => {
  const { name, email, password, role } = values();
  if (!name || !email || !password) return statusEl.textContent = 'Name, email, and password are required.';
  statusEl.textContent = 'Creating account...';

  try {
    if (window.smrSupabaseReady) return await signUpSupabase({ name, email, password, role });

    const users = getUsers();
    if (users.some(u => u.email === email)) return statusEl.textContent = 'Account already exists. Sign in instead.';
    users.push({ name, email, password, role });
    saveUsers(users);
    setLocalSession({ name, email, role });
    go(role);
  } catch (e) {
    statusEl.textContent = e.message || 'Sign up failed.';
  }
});

signInBtn.addEventListener('click', async () => {
  const { email, password } = values();
  if (!email || !password) return statusEl.textContent = 'Email and password are required.';
  statusEl.textContent = 'Signing in...';

  try {
    if (window.smrSupabaseReady) return await signInSupabase({ email, password });

    const users = getUsers();
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) return statusEl.textContent = 'Invalid email/password.';
    setLocalSession(user);
    go(user.role);
  } catch (e) {
    statusEl.textContent = e.message || 'Sign in failed.';
  }
});

if (!window.smrSupabaseReady) {
  statusEl.textContent = 'Supabase Auth not configured yet. Using local dev auth mode.';
}