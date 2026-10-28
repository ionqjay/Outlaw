import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const publicFile = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
for (const page of ['index.html', 'pricing.html', 'login.html', 'reset-password.html']) {
  test(page + ': public shell, landmarks, labels and local assets', () => {
    const doc = new JSDOM(publicFile(page)).window.document;
    assert.ok(doc.body.classList.contains('public-page'));
    assert.equal(doc.querySelectorAll('h1').length, 1);
    assert.ok(doc.querySelector('.skip-link[href="#main-content"]'));
    assert.ok(doc.querySelector('main#main-content[tabindex="-1"]'));
    assert.ok(doc.querySelector('footer nav[aria-label]'));
    const ids = [...doc.querySelectorAll('[id]')].map(el => el.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const el of doc.querySelectorAll('input:not([type="checkbox"]),select')) {
      assert.ok(doc.querySelector('label[for="' + el.id + '"]'), el.id + ' has a label');
    }
    for (const el of doc.querySelectorAll('script[src],link[rel="stylesheet"]')) {
      const path = el.getAttribute('src') || el.getAttribute('href');
      if (path.startsWith('/')) assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
    }
  });
}
test('navigation closes accessibly without stealing unrelated Escape focus', () => {
  const dom = new JSDOM(publicFile('index.html'), { runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(publicFile('navigation.js'));
  const button = window.document.querySelector('.menu-toggle');
  const link = window.document.querySelector('.cta-row a');
  link.focus();
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(window.document.activeElement, link);
  button.click();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Open navigation');
  assert.equal(window.document.activeElement, button);
  button.click();
  window.document.querySelector('#mainNavigation a').click();
  assert.equal(button.getAttribute('aria-label'), 'Open navigation');
});
test('prelaunch pricing and account boundaries remain explicit', () => {
  assert.ok(publicFile('pricing.html').includes('$99'));
  assert.match(publicFile('pricing.html'), /Checkout closed/);
  assert.match(publicFile('index.html'), /repair work is paid separately/);
  const doc = new JSDOM(publicFile('login.html')).window.document;
  for (const id of ['authForm', 'role', 'name', 'email', 'password', 'signInBtn', 'signUpBtn', 'forgotPasswordBtn', 'authStatus', 'specialtiesWrap']) assert.ok(doc.getElementById(id));
});
