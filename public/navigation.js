(() => {
  const button = document.querySelector('.menu-toggle');
  const menu = document.getElementById('mainNavigation');
  if (!button || !menu) return;
  function close() { menu.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); }
  button.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); button.focus(); } });
  menu.addEventListener('click', event => { if (event.target.closest('a')) close(); });
})();
