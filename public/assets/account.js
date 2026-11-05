import { api, h, setYear, formatDate } from '/assets/ui.js';
import { DAYS, LEVELS, SECTIONS, TIMES, TRACKS, validateAnswers } from '/assets/questions.js';
setYear();

const $ = (id) => document.getElementById(id);
const state = { tracks: new Set(), answers: {}, submittedAt: null, dirty: false };
let saveTimer = null;

// ---------- Rendering questions ----------

const chip = (type, name, value, label, checked, onChange) =>
  h('label', { class: 'chip' }, h('input', { type, name, value, checked, onchange: onChange }), h('span', {}, label));

function renderField(q) {
  const value = state.answers[q.id];
  const set = (v) => {
    state.answers[q.id] = v;
    changed();
  };
  const heading = [q.label, q.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null];
  const help = q.help ? h('span', { class: 'help' }, q.help) : null;

  if (q.type === 'text' || q.type === 'textarea') {
    const props = { class: 'input', id: `q-${q.id}`, value: value ?? '', placeholder: q.placeholder, maxLength: q.type === 'text' ? 300 : 2000, oninput: (e) => set(e.target.value) };
    return h('label', { class: 'field', id: `f-${q.id}` }, h('span', { class: 'q' }, heading), help, q.type === 'text' ? h('input', props) : h('textarea', props));
  }

  let control;
  if (q.type === 'single') {
    control = h('div', { class: 'chips' }, q.options.map((o) => chip('radio', q.id, o.value, o.label, value === o.value, () => set(o.value))));
  } else if (q.type === 'multi') {
    const chosen = new Set(value || []);
    control = h('div', { class: 'chips' }, q.options.map((o) => chip('checkbox', q.id, o.value, o.label, chosen.has(o.value), (e) => {
      e.target.checked ? chosen.add(o.value) : chosen.delete(o.value);
      set([...chosen]);
    })));
  } else if (q.type === 'levels') {
    const held = { ...(value || {}) };
    control = h('div', { class: 'levels' }, q.options.map((o) => {
      const name = `${q.id}-${o.value}`;
      return [
        h('span', { id: name }, o.label),
        h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': name }, LEVELS.map((l) => {
          const input = chip('radio', name, l.value, l.label, held[o.value] === l.value, () => {
            held[o.value] = l.value;
            set({ ...held });
          });
          // Clicking the chosen level again clears it, since "doesn't play this" is the default.
          input.querySelector('input').addEventListener('click', (e) => {
            const was = input.dataset.was;
            input.dataset.was = '';
            if (was === 'on') {
              e.target.checked = false;
              delete held[o.value];
              set({ ...held });
            }
          });
          input.addEventListener('pointerdown', () => {
            input.dataset.was = input.querySelector('input').checked ? 'on' : '';
          });
          return input;
        })),
      ];
    }));
  } else if (q.type === 'slots') {
    const chosen = new Set(value || []);
    control = h('table', { class: 'slots' },
      h('thead', {}, h('tr', {}, h('td'), DAYS.map((d) => h('th', { scope: 'col' }, d)))),
      h('tbody', {}, TIMES.map((t) => h('tr', {}, h('th', { scope: 'row' }, t.label), DAYS.map((d) => {
        const slot = `${d.toLowerCase()}_${t.value}`;
        return h('td', {}, h('label', { class: 'slot' }, h('input', { type: 'checkbox', checked: chosen.has(slot), 'aria-label': `${d} ${t.label}`, onchange: (e) => {
          e.target.checked ? chosen.add(slot) : chosen.delete(slot);
          set([...chosen]);
        } }), h('span')));
      })))));
  }
  return h('fieldset', { class: 'field', id: `f-${q.id}` }, h('legend', {}, heading), help, control);
}

function renderSections() {
  const open = SECTIONS.filter((s) => !s.track || state.tracks.has(s.track));
  $('sections').replaceChildren(...open.map((s) => h('div', { class: 'q-section', id: `s-${s.id}` }, h('h2', {}, s.title), s.questions.map(renderField))));
}

function renderTracks() {
  $('tracks').replaceChildren(...Object.entries(TRACKS).map(([id, t]) =>
    h('label', { class: 'track' },
      h('input', { type: 'checkbox', checked: state.tracks.has(id), onchange: (e) => {
        e.target.checked ? state.tracks.add(id) : state.tracks.delete(id);
        renderSections();
        changed();
      } }),
      h('span', {}, h('strong', {}, t.name), t.blurb))));
}

// ---------- Status ----------

function renderStatus(release) {
  const body = [];
  for (const g of release.groups) {
    body.push(h('div', { class: 'section', style: 'padding-top:0' },
      h('h3', {}, g.name),
      h('p', { class: 'muted' }, `${TRACKS[g.track].name} · released ${formatDate(g.publishedAt)}`),
      h('ul', { class: 'list' }, g.members.map((m) => h('li', { class: 'mate' },
        h('strong', {}, m.name), m.parts.length ? ` · ${m.parts.join(', ')}` : '', ' · ', h('a', { class: 'inline-link', href: `mailto:${m.email}` }, m.email))))));
  }
  const mine = [...state.tracks];
  const placed = new Set(release.groups.map((g) => g.track));
  if (state.submittedAt) {
    for (const t of mine) {
      if (placed.has(t)) continue;
      if (release.published.includes(t)) {
        body.push(h('p', {}, `${TRACKS[t].name} groups are out, and you are not in one yet. Write to `, h('a', { href: 'mailto:hello@sonorum.org' }, 'hello@sonorum.org'), ' and we will sort it out.'));
      } else {
        body.push(h('p', {}, `The Board has your answers for ${TRACKS[t].name}. Your group will appear here once it is released.`));
      }
    }
  }
  $('status').hidden = !body.length;
  $('status-body').replaceChildren(...body);
}

// ---------- Saving ----------

function changed() {
  state.dirty = true;
  clearInvalid();
  if (state.submittedAt) {
    $('save-state').textContent = 'Unsaved changes';
    return;
  }
  // Drafts save themselves. Once with the board, changes wait for the button so nobody sees half an edit.
  $('save-state').textContent = '';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 800);
}

const payload = (submit) => ({ tracks: [...state.tracks], answers: state.answers, submit });

async function saveDraft() {
  try {
    await api('/me/profile', { method: 'PUT', body: payload(false) });
    state.dirty = false;
    $('save-state').textContent = 'Draft saved';
  } catch (err) {
    $('save-state').textContent = 'Could not save your draft';
  }
}

function clearInvalid() {
  $('form-error').hidden = true;
  document.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
}

function markInvalid(ids) {
  ids.forEach((id) => $(`f-${id}`)?.classList.add('invalid'));
  const first = document.querySelector('.field.invalid');
  first?.scrollIntoView({ block: 'center' });
  first?.querySelector('input,textarea')?.focus({ preventScroll: true });
}

function showFormError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
}

$('profile').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearTimeout(saveTimer);
  clearInvalid();
  const tracks = [...state.tracks];
  if (!tracks.length) {
    showFormError('Choose sonorumBands, sonorumCreate, or both.');
    return markInvalid(['tracks']);
  }
  const { missing } = validateAnswers(state.answers, tracks);
  if (missing.length) {
    showFormError(`${missing.length === 1 ? 'One required question is' : `${missing.length} required questions are`} still empty.`);
    return markInvalid(missing);
  }
  $('submit').disabled = true;
  try {
    const out = await api('/me/profile', { method: 'PUT', body: payload(true) });
    state.submittedAt = out.submittedAt;
    state.dirty = false;
    $('submit').textContent = 'Save changes';
    $('save-state').textContent = 'Saved. The Board has your answers.';
    const { release } = await api('/me');
    renderStatus(release);
    window.scrollTo({ top: 0 });
  } catch (err) {
    showFormError(err.message);
    if (err.data?.missing) markInvalid(err.data.missing);
  } finally {
    $('submit').disabled = false;
  }
});

$('signout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.href = '/';
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

// ---------- Start ----------

function askToVerify(token) {
  $('hello').textContent = 'Confirm your email';
  $('signout').hidden = true;
  $('verify').hidden = false;
  $('verify-password').focus();
  $('verify').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('verify').querySelector('button');
    $('verify-error').hidden = true;
    button.disabled = true;
    try {
      await api('/auth/verify', { method: 'POST', body: { token, password: $('verify-password').value } });
      $('verify').hidden = true;
      $('signout').hidden = false;
      await start();
    } catch (err) {
      $('verify-error').textContent = err.message;
      $('verify-error').hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

async function start() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('verify=')) history.replaceState(null, '', location.pathname);
  const me = await api('/me');
  if (!me.user && hash.startsWith('verify=')) return askToVerify(hash.slice(7));
  if (!me.user) {
    location.replace('/join/#signin');
    return;
  }
  $('hello').textContent = `Hello, ${me.user.name}`;
  $('who').textContent = me.user.email;
  $('board-link').hidden = !me.user.isBoard;
  if (me.profile) {
    state.tracks = new Set(me.profile.tracks);
    state.answers = me.profile.answers;
    state.submittedAt = me.profile.submittedAt;
  }
  if (state.submittedAt) $('submit').textContent = 'Save changes';
  renderTracks();
  renderSections();
  renderStatus(me.release);
  $('profile').hidden = false;
}

start().catch((err) => {
  $('load-error').textContent = err.message;
  $('load-error').hidden = false;
});
