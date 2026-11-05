import { api, setYear } from '/assets/ui.js';
import { CONSENT_TEXT } from '/assets/questions.js';
setYear();
document.querySelector('[data-consent-text]').textContent = CONSENT_TEXT;

const views = [...document.querySelectorAll('[data-view]')];
const show = (name) => views.forEach((v) => (v.hidden = v.dataset.view !== name));
let resetToken = null;
let turnstileId = null;

function route() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('reset=')) {
    resetToken = hash.slice(6);
    history.replaceState(null, '', location.pathname + '#reset');
    return show('reset');
  }
  if (hash === 'reset' && resetToken) return show('reset');
  show(['signin', 'forgot'].includes(hash) ? hash : 'signup');
}

function sent(text) {
  document.getElementById('sent-text').textContent = text;
  show('sent');
}

async function goInside() {
  const { user } = await api('/me');
  location.href = user?.isBoard ? '/board/' : '/account/';
}

function wire(id, handler) {
  const form = document.getElementById(id);
  const error = form.querySelector('[data-error]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    error.hidden = true;
    button.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      if (id === 'signup' && window.turnstile && turnstileId !== null) window.turnstile.reset(turnstileId);
    } finally {
      button.disabled = false;
    }
  });
}

wire('signup', async (f) => {
  await api('/auth/signup', { method: 'POST', body: { fullName: f.fullName, email: f.email, password: f.password, consent: f.consent === 'on', turnstileToken: f['cf-turnstile-response'] } });
  sent(`We sent a link to ${f.email}. Open it to finish creating your account. If it does not arrive, check your spam folder.`);
});
wire('signin', async (f) => {
  await api('/auth/login', { method: 'POST', body: f });
  await goInside();
});
wire('forgot', async (f) => {
  await api('/auth/forgot', { method: 'POST', body: f });
  sent(`If ${f.email} has an account, a reset link is on its way.`);
});
wire('reset', async (f) => {
  await api('/auth/reset', { method: 'POST', body: { token: resetToken, password: f.password } });
  await goInside();
});

window.addEventListener('hashchange', route);
route();

// Already signed in: nothing to do here (a reset link still gets through).
api('/me').then(({ user }) => {
  if (user && !resetToken) goInside();
}).catch(() => {});

api('/config').then(({ turnstileSiteKey }) => {
  if (!turnstileSiteKey) return;
  window.onTurnstileLoad = () => {
    turnstileId = window.turnstile.render('#turnstile', { sitekey: turnstileSiteKey, theme: 'light' });
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
  s.async = true;
  document.head.append(s);
}).catch(() => {});
