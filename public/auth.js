function setLocalSession({ email, role, name }) {
  const id = btoa(String(email).toLowerCase()).replace(/=+$/,'');
  localStorage.setItem('smr_session', JSON.stringify({ id, email, role, name: name || '' }));
  return { id, email, role, name: name || '' };
}
function getUsers(){ return JSON.parse(localStorage.getItem('smr_users') || '[]'); }
function saveUsers(users){ localStorage.setItem('smr_users', JSON.stringify(users)); }
function go(role){ window.location.href = role === 'mechanic' ? '/mechanic.html' : '/owner-app.html'; }

const statusEl = document.getElementById('authStatus');

document.getElementById('signUpBtn').addEventListener('click', () => {
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  const role = document.getElementById('role').value;
  if (!name || !email || !password) return statusEl.textContent = 'Name, email, and password are required.';

  const users = getUsers();
  if (users.some(u => u.email === email)) return statusEl.textContent = 'Account already exists. Sign in instead.';
  users.push({ name, email, password, role });
  saveUsers(users);
  setLocalSession({ name, email, role });
  go(role);
});

document.getElementById('signInBtn').addEventListener('click', () => {
  const email = document.getElementById('email').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  const users = getUsers();
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return statusEl.textContent = 'Invalid email/password.';
  setLocalSession(user);
  go(user.role);
});