(() => {
  const status = document.getElementById('resetStatus');
  const button = document.getElementById('resetBtn');
  const client = window.smrSupabase;
  if (!client) { status.textContent = 'Account recovery is temporarily unavailable.'; return; }
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      button.disabled = false;
      status.textContent = 'Your link is valid. Enter your new password.';
    }
  });
  client.auth.getSession().then(({ data, error }) => {
    if (data?.session && !error) { button.disabled = false; status.textContent = 'Enter your new password.'; }
    else status.textContent = 'This link is missing or expired. Return to Sign in and request a new recovery email.';
  });
  document.getElementById('resetForm').addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('newPassword').value;
    if (password !== document.getElementById('confirmPassword').value) { status.textContent = 'Passwords do not match.'; return; }
    if (password.length < 12) { status.textContent = 'Use at least 12 characters.'; return; }
    button.disabled = true;
    const { error } = await client.auth.updateUser({ password });
    if (error) { status.textContent = error.message; button.disabled = false; return; }
    await client.auth.signOut();
    status.textContent = 'Password saved. You can now sign in with your new password.';
    document.getElementById('resetForm').reset();
  });
})();
