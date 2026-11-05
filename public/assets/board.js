import { api, h, formatDate, formatTime } from '/assets/ui.js';
import { COVERAGE, DAYS, LEVELS, SECTIONS, TRACKS, findOption, slotLabel } from '/assets/questions.js';

const $ = (id) => document.getElementById(id);
const POLL_MS = 5000;
const toastEl = $('toast');

const S = {
  me: null,
  data: null,
  track: new URLSearchParams(location.search).get('track') === 'create' ? 'create' : 'bands',
  query: '',
  part: '',
  day: '',
  drawerFor: null,
  fresh: null, // card to flash after it lands
  renderWaiting: false,
};

// ---------- Reading the data ----------

const memberById = (id) => S.data.members.find((m) => m.id === id);
const trackGroups = (track = S.track) => S.data.groups.filter((g) => g.track === track);
const trackMembers = (track = S.track) => S.data.members.filter((m) => !m.archived && m.tracks.includes(track));
const groupsOf = (id, track = S.track) => trackGroups(track).filter((g) => g.memberIds.includes(id));
const unplaced = (track = S.track) => trackMembers(track).filter((m) => !groupsOf(m.id, track).length);

const coverQuestion = () => COVERAGE[S.track].question;
const held = (m) => m.answers[coverQuestion()] || {};
const label = (qid, v) => findOption(qid, v);

const initials = { junior: 'Jr', lower: 'Lo', upper: 'Up', senior: 'Sr', post_grad: 'PG' };

function coverage(group) {
  const people = group.memberIds.map(memberById).filter(Boolean);
  const { core } = COVERAGE[S.track];
  const has = new Set(people.flatMap((m) => Object.keys(held(m))));
  const shared = (key) => {
    if (!people.length) return [];
    return people.map((m) => m.answers[key] || []).reduce((a, b) => a.filter((x) => b.includes(x)));
  };
  return { people, needs: core.filter((c) => !has.has(c)), times: shared('availability'), genres: shared('genres') };
}

/** How well a person suits a group: fills gaps, can meet, likes the same things, and the group has room. */
function fit(member, group) {
  const c = coverage(group);
  const fills = c.needs.filter((n) => held(member)[n]);
  const avail = member.answers.availability || [];
  const times = c.people.length ? c.times.filter((t) => avail.includes(t)) : avail;
  const genres = c.people.length ? c.genres.filter((g) => (member.answers.genres || []).includes(g)) : [];
  let score = fills.length * 3 + Math.min(times.length, 3) + genres.length;
  if (c.people.length && !times.length) score -= 4;
  score -= Math.max(0, c.people.length - 4);
  const reasons = [];
  if (fills.length) reasons.push(`fills ${fills.map((f) => label(coverQuestion(), f).toLowerCase()).join(', ')}`);
  if (c.people.length) reasons.push(times.length ? `${times.length} shared ${times.length === 1 ? 'time' : 'times'}` : 'no shared time');
  if (genres.length) reasons.push(genres.map((g) => label('genres', g)).join(', '));
  return { group, score, reasons };
}

/** Compares the draft with what members can currently see. */
function changesSincePublish(track = S.track) {
  const pub = S.data.publications[track];
  const draft = trackGroups(track).filter((g) => g.memberIds.length);
  if (!pub) return draft.length;
  const key = (name, ids) => `${name}|${[...ids].sort().join(',')}`;
  const live = new Map(pub.snapshot.groups.map((g) => [g.id, key(g.name, g.members.map((m) => m.id))]));
  let changed = 0;
  for (const g of draft) {
    if (live.get(g.id) !== key(g.name, g.memberIds)) changed++;
    live.delete(g.id);
  }
  return changed + live.size;
}

function matches(m) {
  if (S.part && !held(m)[S.part]) return false;
  if (S.day && !(m.answers.availability || []).some((s) => s.startsWith(S.day))) return false;
  if (S.query) {
    const hay = [m.name, m.email, ...Object.values(m.answers).flatMap((v) => (typeof v === 'string' ? v : Array.isArray(v) ? v : Object.keys(v)))].join(' ').toLowerCase();
    if (!S.query.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

// ---------- Rendering ----------

function partsLine(m) {
  const rank = { strong: 0, comfortable: 1, learning: 2 };
  const parts = Object.entries(held(m)).sort((a, b) => rank[a[1]] - rank[b[1]]);
  return parts.map(([p, lvl]) => `${label(coverQuestion(), p)}${lvl === 'strong' ? ' ★' : lvl === 'learning' ? ' (learning)' : ''}`).join(', ');
}

function card(m, fromGroupId) {
  const genres = (m.answers.genres || []).slice(0, 3).map((g) => label('genres', g)).join(', ');
  const others = groupsOf(m.id).filter((g) => g.id !== fromGroupId);
  const named = S.track === 'bands' ? m.answers.band_with : m.answers.create_with;
  const el = h('button', { type: 'button', class: `card${S.fresh === m.id ? ' fresh' : ''}`, dataset: { id: m.id, from: fromGroupId || '' } },
    h('span', { class: 'name' }, h('span', {}, m.name), h('span', { class: 'year' }, initials[m.answers.year] || '')),
    h('span', { class: 'line' }, partsLine(m)),
    h('span', { class: 'sub' }, [genres, `${(m.answers.availability || []).length} times`].filter(Boolean).join(' · ')),
    named ? h('span', { class: 'sub' }, `Asked for: ${named}`) : null,
    others.length ? h('span', { class: 'flag' }, `Also in ${others.map((g) => g.name).join(', ')}`) : null,
    m.note ? h('span', { class: 'flag' }, 'Board note') : null);
  el.addEventListener('pointerdown', (e) => startDrag(e, el, m, fromGroupId));
  el.addEventListener('click', () => {
    if (!suppressClick) openDrawer(m.id);
  });
  return el;
}

function renderTabs() {
  $('tabs').replaceChildren(...Object.entries(TRACKS).map(([id, t]) =>
    h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(id === S.track), onclick: () => {
      if (S.track === id) return;
      S.track = id;
      S.part = '';
      history.replaceState(null, '', id === 'bands' ? location.pathname : `?track=${id}`);
      renderAll();
    } }, t.name, h('span', { class: 'count' }, String(trackMembers(id).length)))));
}

function renderRelease() {
  const pub = S.data.publications[S.track];
  const changes = changesSincePublish();
  const placedCount = new Set(trackGroups().flatMap((g) => g.memberIds)).size;
  let state;
  if (!pub) {
    state = [h('strong', { class: 'draft' }, 'Draft. '), 'Members cannot see any of this until you publish.'];
  } else if (changes) {
    state = [h('strong', { class: 'draft' }, `${changes} ${changes === 1 ? 'group has' : 'groups have'} unpublished changes. `), `Members still see what was released ${formatDate(pub.publishedAt)} by ${pub.publishedBy}.`];
  } else {
    state = [h('strong', {}, 'Published. '), `Members can see this, released ${formatDate(pub.publishedAt)} by ${pub.publishedBy}.`];
  }
  $('release').replaceChildren(
    h('div', { class: 'state' }, state),
    h('div', { class: 'actions' },
      pub ? h('button', { class: 'btn', type: 'button', onclick: confirmUnpublish }, 'Unpublish') : null,
      h('button', { class: 'btn primary', type: 'button', disabled: !placedCount || (pub && !changes), onclick: reviewPublish }, pub ? 'Publish changes' : 'Review and publish')));
}

function renderFilters() {
  const q = SECTIONS.flatMap((s) => s.questions).find((x) => x.id === coverQuestion());
  const part = $('f-part');
  part.replaceChildren(h('option', { value: '' }, S.track === 'bands' ? 'Any part' : 'Any role'), ...q.options.map((o) => h('option', { value: o.value }, o.label)));
  part.value = S.part;
  const day = $('f-day');
  if (!day.options.length) day.replaceChildren(h('option', { value: '' }, 'Any day'), ...DAYS.map((d) => h('option', { value: d.toLowerCase() }, d)));
  day.value = S.day;
}

function renderPool() {
  const all = unplaced();
  const shown = all.filter(matches);
  $('pool-title').textContent = shown.length === all.length ? `Not placed (${all.length})` : `Not placed (${shown.length} of ${all.length})`;
  const empty = all.length ? 'Nobody matches those filters.' : trackMembers().length ? 'Everyone is placed.' : 'Nobody has signed up for this yet.';
  $('pool').replaceChildren(...(shown.length ? shown.map((m) => card(m, null)) : [h('p', { class: 'drop-empty' }, empty)]));

  const archived = S.data.members.filter((m) => m.archived && m.tracks.includes(S.track));
  $('pool-foot').replaceChildren(
    S.data.draftCount ? h('p', { class: 'muted', style: 'margin:8px 0 0' }, `${S.data.draftCount} ${S.data.draftCount === 1 ? 'person is' : 'people are'} still filling out the form.`) : '',
    archived.length ? h('details', { class: 'muted', style: 'margin-top:8px' }, h('summary', {}, `Removed from sorting (${archived.length})`), archived.map((m) => h('div', {}, h('button', { class: 'link-btn', type: 'button', onclick: () => openDrawer(m.id) }, m.name)))) : '');
}

function groupColumn(g) {
  const c = coverage(g);
  const nameInput = h('input', { value: g.name, 'aria-label': 'Group name', maxLength: 80, onchange: (e) => {
    const name = e.target.value.trim();
    if (!name) return (e.target.value = g.name);
    g.name = name;
    mutate(() => api(`/board/groups/${g.id}`, { method: 'PATCH', body: { name } }));
  } });
  const notes = h('textarea', { class: 'input', value: g.notes, placeholder: 'Only the board sees this', maxLength: 2000, onchange: (e) => {
    g.notes = e.target.value;
    mutate(() => api(`/board/groups/${g.id}`, { method: 'PATCH', body: { notes: g.notes } }));
  } });
  const needsLabel = S.track === 'bands' ? 'Needs' : 'Missing';
  return h('article', { class: 'group', dataset: { group: g.id } },
    h('div', { class: 'group-title' }, nameInput, h('span', { class: 'muted' }, String(c.people.length))),
    h('div', { class: 'group-meta' },
      c.people.length ? h('div', { class: c.needs.length ? 'needs' : 'muted' }, c.needs.length ? `${needsLabel}: ${c.needs.map((n) => label(coverQuestion(), n)).join(', ')}` : 'All core parts covered') : null,
      c.people.length > 1 ? h('div', { class: c.times.length ? 'muted' : 'needs' }, c.times.length ? `Can all meet: ${c.times.slice(0, 3).map(slotLabel).join(', ')}${c.times.length > 3 ? ` +${c.times.length - 3}` : ''}` : 'No time when everyone can meet') : null,
      c.people.length > 1 && c.genres.length ? h('div', { class: 'muted' }, `All like: ${c.genres.map((x) => label('genres', x)).join(', ')}`) : null,
      h('div', { class: 'fit' })),
    h('div', { class: 'drop', dataset: { drop: g.id } }, c.people.length ? c.people.map((m) => card(m, g.id)) : h('p', { class: 'drop-empty' }, 'Drag people here.')),
    h('div', { class: 'group-foot' },
      h('details', { open: !!g.notes || undefined }, h('summary', {}, 'Notes'), notes),
      h('button', { class: 'link-btn', type: 'button', onclick: () => confirmDeleteGroup(g) }, 'Delete')));
}

function renderGroups() {
  const groups = trackGroups();
  $('groups').replaceChildren(...(groups.length ? groups.map(groupColumn) : [h('p', { class: 'muted' }, 'No groups yet. Start one with New group, then drag people into it.')]));
}

function renderSync() {
  const d = S.data;
  $('sync').textContent = d.updatedAt ? `Saved and shared with the board. Last change ${formatTime(d.updatedAt)} by ${d.updatedBy}.` : 'Everything here is saved and shared with the board.';
}

function renderAll() {
  renderTabs();
  renderRelease();
  renderFilters();
  renderPool();
  renderGroups();
  renderSync();
  S.fresh = null;
}

/** Holds a redraw while someone is mid-drag or mid-typing, so their work is not swept away. */
function busy() {
  const a = document.activeElement;
  return drag.active || (a && a.closest('#groups') && a.matches('input, textarea'));
}

function renderSoon() {
  if (busy()) {
    S.renderWaiting = true;
    return;
  }
  S.renderWaiting = false;
  renderAll();
}
document.addEventListener('focusout', () => setTimeout(() => S.renderWaiting && renderSoon(), 150));

// ---------- Syncing with the server ----------

let refreshSeq = 0;
let inFlight = 0;

async function refresh() {
  const seq = ++refreshSeq;
  const data = await api('/board/state');
  // A slower, older reply, or one that predates a save still in progress, must not undo newer changes on screen.
  if (seq !== refreshSeq || inFlight) return;
  S.data = data;
  renderSoon();
  if (S.drawerFor && $('drawer').open) renderDrawer();
}

let queue = Promise.resolve();

/** Runs saves one at a time in order. Everyone else's tabs pick them up from the revision poll. */
function mutate(call) {
  inFlight++;
  $('sync').textContent = 'Saving…';
  queue = queue.then(call).then(
    () => {
      inFlight--;
      return inFlight ? null : refresh();
    },
    async (err) => {
      inFlight--;
      toast(err.message);
      await refresh();
    },
  );
  return queue;
}

async function poll() {
  if (document.hidden || inFlight) return;
  try {
    const { revision } = await api('/board/revision');
    if (revision !== S.data.revision) await refresh();
  } catch (err) {
    if (err.status === 401 || err.status === 403) location.reload();
    $('sync').textContent = 'Having trouble reaching the server. Retrying…';
  }
}

// ---------- Moving people ----------

function placeLocal(userId, fromId, toId) {
  const from = S.data.groups.find((g) => g.id === fromId);
  const to = S.data.groups.find((g) => g.id === toId);
  if (from) from.memberIds = from.memberIds.filter((x) => x !== userId);
  if (to && !to.memberIds.includes(userId)) to.memberIds.push(userId);
}

function place(userId, fromId, toId, { silent } = {}) {
  if (fromId === toId) return;
  placeLocal(userId, fromId, toId);
  S.fresh = userId;
  renderAll();
  if (S.drawerFor && $('drawer').open) renderDrawer();
  mutate(() => api('/board/place', { method: 'POST', body: { userId, fromGroupId: fromId, toGroupId: toId } }));
  if (silent) return;
  const m = memberById(userId);
  const to = S.data.groups.find((g) => g.id === toId);
  toast(to ? `${m.name} is in ${to.name}.` : `${m.name} is back with the unplaced.`, { label: 'Undo', run: () => place(userId, toId, fromId, { silent: true }) });
}

// Dragging uses pointer events so the card follows the cursor exactly and can be cancelled with Escape.
// Touch keeps its normal scrolling; on a phone or tablet, tap a card and use Move to.
const drag = { active: false };
let suppressClick = false;

function startDrag(e, el, member, fromId) {
  if (e.button !== 0 || e.pointerType === 'touch' || drag.pointerId !== undefined) return;
  const rect = el.getBoundingClientRect();
  Object.assign(drag, { pointerId: e.pointerId, el, member, fromId, startX: e.clientX, startY: e.clientY, offX: e.clientX - rect.left, offY: e.clientY - rect.top, width: rect.width, target: null, active: false, copy: false });
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('keydown', onDragKey);
}

function beginDragVisuals() {
  drag.active = true;
  drag.ghost = drag.el.cloneNode(true);
  drag.ghost.classList.add('ghost');
  drag.ghost.classList.remove('fresh');
  drag.ghost.style.width = `${drag.width}px`;
  document.body.append(drag.ghost);
  drag.el.classList.add('lifted');
  document.body.classList.add('dragging');
  // While carrying someone, each group says what they would bring to it.
  document.querySelectorAll('.group').forEach((col) => {
    const g = S.data.groups.find((x) => x.id === col.dataset.group);
    if (!g || g.id === drag.fromId) return;
    col.querySelector('.fit').textContent = fit(drag.member, g).reasons.join(' · ');
  });
}

function onDragMove(e) {
  if (e.pointerId !== drag.pointerId) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
    beginDragVisuals();
  }
  drag.copy = e.altKey;
  drag.ghost.style.transform = `translate3d(${e.clientX - drag.offX}px, ${e.clientY - drag.offY}px, 0)`;
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const column = over?.closest('.group');
  const zone = column ? column.querySelector('[data-drop]') : over?.closest('#pool-col') ? $('pool') : null;
  if (zone !== drag.target) {
    drag.target?.classList.remove('over');
    zone?.classList.add('over');
    drag.target = zone;
  }
  if (e.clientY < 60) window.scrollBy(0, -12);
  else if (e.clientY > innerHeight - 60) window.scrollBy(0, 12);
}

function endDragListeners() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', cancelDrag);
  window.removeEventListener('keydown', onDragKey);
  drag.ghost?.remove();
  drag.target?.classList.remove('over');
  drag.el?.classList.remove('lifted');
  document.body.classList.remove('dragging');
  const wasActive = drag.active;
  drag.active = false;
  drag.pointerId = undefined;
  drag.ghost = null;
  if (wasActive) {
    // The click that ends a drag must not also open the person's panel.
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  }
  return wasActive;
}

function onDragEnd(e) {
  if (e.pointerId !== drag.pointerId) return;
  const { target, member, fromId, copy } = drag;
  const wasActive = endDragListeners();
  if (wasActive && target) {
    const toId = target.dataset.drop === 'pool' ? null : target.dataset.drop;
    if (toId !== fromId && (toId || fromId)) place(member.id, copy ? null : fromId, toId);
  }
  if (S.renderWaiting) renderSoon();
}

function cancelDrag() {
  endDragListeners();
  if (S.renderWaiting) renderSoon();
}

function onDragKey(e) {
  if (e.key === 'Escape') cancelDrag();
}

// ---------- Side panel ----------

function openDrawer(id) {
  S.drawerFor = id;
  renderDrawer();
  if (!$('drawer').open) $('drawer').showModal();
}

function answerText(q, v) {
  if (q.type === 'single') return label(q.id, v);
  if (q.type === 'multi') return v.map((x) => label(q.id, x)).join(', ');
  if (q.type === 'slots') return v.map(slotLabel).join(', ');
  if (q.type === 'levels') return Object.entries(v).map(([k, l]) => `${label(q.id, k)}: ${LEVELS.find((x) => x.value === l)?.label.toLowerCase()}`).join(', ');
  return v;
}

function renderDrawer() {
  const m = memberById(S.drawerFor);
  const drawer = $('drawer');
  if (!m) {
    drawer.close();
    return;
  }
  const placed = groupsOf(m.id);
  const open = trackGroups().filter((g) => !g.memberIds.includes(m.id));
  const ranked = m.archived ? [] : open.map((g) => fit(m, g)).sort((a, b) => b.score - a.score);
  const select = h('select', { class: 'input', 'aria-label': 'Choose a group' }, ranked.map((r) => h('option', { value: r.group.id }, r.group.name)));

  const sections = SECTIONS.filter((s) => !s.track || m.tracks.includes(s.track)).map((s) => {
    const rows = s.questions.filter((q) => m.answers[q.id] !== undefined).map((q) =>
      h('div', { class: `answer${q.boardOnly ? ' private' : ''}` }, h('dt', {}, q.label), h('dd', {}, answerText(q, m.answers[q.id]))));
    return rows.length ? [h('h3', {}, s.title), h('dl', { style: 'margin:0' }, rows)] : null;
  });

  const note = h('textarea', { class: 'input', value: m.note, id: 'drawer-note', maxLength: 4000, placeholder: 'Members never see this', onchange: (e) => {
    m.note = e.target.value;
    mutate(() => api(`/board/notes/${m.id}`, { method: 'PUT', body: { note: m.note } }));
  } });

  drawer.replaceChildren(
    h('div', { class: 'drawer-head' }, h('h2', { id: 'drawer-title', style: 'margin:0' }, m.name), h('button', { class: 'link-btn', type: 'button', onclick: () => drawer.close() }, 'Close')),
    h('a', { class: 'inline-link', href: `mailto:${m.email}` }, m.email),
    ...[m.archived
      ? [h('h3', {}, 'Removed from sorting'), h('button', { class: 'btn', type: 'button', onclick: () => setArchived(m, false) }, 'Bring back')]
      : [
          h('h3', {}, `Placement in ${TRACKS[S.track].name}`),
          placed.length
            ? placed.map((g) => h('div', { class: 'placed' }, h('span', {}, g.name), h('button', { class: 'link-btn', type: 'button', onclick: () => place(m.id, g.id, null) }, 'Take out')))
            : h('p', { class: 'muted', style: 'margin:0 0 8px' }, 'Not placed yet.'),
          ranked.length
            ? [
                h('div', { class: 'place-row', style: 'margin-top:8px' }, select,
                  h('div', { style: 'display:flex;gap:6px' },
                    placed.length === 1 ? h('button', { class: 'btn', type: 'button', onclick: () => place(m.id, placed[0].id, select.value) }, 'Move') : null,
                    h('button', { class: 'btn', type: 'button', onclick: () => place(m.id, null, select.value) }, placed.length ? 'Also add' : 'Add'))),
                ranked[0].reasons.length ? h('p', { class: 'muted' }, `Best fit: ${ranked[0].group.name} (${ranked[0].reasons.join(', ')})`) : null,
              ]
            : placed.length ? null : h('p', { class: 'muted' }, 'Make a group first.'),
        ],
    h('h3', {}, 'Board note'),
    note,
    sections,
    m.archived ? null : h('p', { style: 'margin-top:24px' }, h('button', { class: 'link-btn muted', type: 'button', onclick: () => confirmArchive(m) }, 'Remove from sorting'))].flat(Infinity).filter(Boolean));
  drawer.append(toastEl); // redrawing clears the panel, and the toast must stay reachable above it
}

function setArchived(m, archived) {
  m.archived = archived;
  if (archived) S.data.groups.forEach((g) => (g.memberIds = g.memberIds.filter((x) => x !== m.id)));
  renderAll();
  renderDrawer();
  mutate(() => api(`/board/notes/${m.id}`, { method: 'PUT', body: { archived } }));
}

$('drawer').addEventListener('click', (e) => {
  if (e.target === $('drawer')) $('drawer').close(); // a click on the backdrop
});
$('drawer').addEventListener('close', () => {
  S.drawerFor = null;
  document.body.append(toastEl);
});

// ---------- Dialogs ----------

function dialog(content) {
  const modal = $('modal');
  modal.replaceChildren(...content.filter(Boolean));
  if (!modal.open) modal.showModal();
  return modal;
}

function confirmBox(title, text, action, run) {
  const modal = dialog([
    h('h2', {}, title),
    h('p', {}, text),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => {
        modal.close();
        run();
      } }, action)),
  ]);
}

function confirmDeleteGroup(g) {
  const run = () => {
    S.data.groups = S.data.groups.filter((x) => x.id !== g.id);
    renderAll();
    mutate(() => api(`/board/groups/${g.id}`, { method: 'DELETE', body: {} }));
  };
  if (!g.memberIds.length) return run();
  confirmBox(`Delete ${g.name}?`, `${g.memberIds.length} ${g.memberIds.length === 1 ? 'person goes' : 'people go'} back to the unplaced list.`, 'Delete group', run);
}

function confirmArchive(m) {
  confirmBox(`Remove ${m.name} from sorting?`, 'They leave every group and the unplaced list. You can bring them back at any time. Their account and answers stay.', 'Remove', () => setArchived(m, true));
}

function confirmUnpublish() {
  confirmBox(`Unpublish ${TRACKS[S.track].name}?`, 'Members stop seeing these groups right away. Your draft stays as it is.', 'Unpublish', () => {
    mutate(() => api(`/board/unpublish/${S.track}`, { method: 'POST' }));
  });
}

async function reviewPublish() {
  // Wait for saves to land first, so the review shows exactly what the server will release.
  await queue;
  await refresh();
  const track = S.track;
  const revision = S.data.revision;
  const groups = trackGroups().filter((g) => g.memberIds.length);
  const empties = trackGroups().length - groups.length;
  const left = unplaced();
  const modal = dialog([
    h('h2', {}, `Publish ${TRACKS[track].name}`),
    h('p', {}, 'Each person will see their own group when they sign in: the group name, and everyone’s name, email, and parts. Board notes and private answers stay private. Nobody is emailed.'),
    h('ul', { class: 'review' }, groups.map((g) => h('li', {}, h('strong', {}, g.name), ` · ${g.memberIds.map((id) => memberById(id)?.name).join(', ')}`))),
    left.length ? h('p', { class: 'needs' }, `${left.length} ${left.length === 1 ? 'person is' : 'people are'} not placed: ${left.map((m) => m.name).join(', ')}.`) : null,
    empties ? h('p', { class: 'muted' }, `${empties} empty ${empties === 1 ? 'group' : 'groups'} will be left out.`) : null,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Keep editing'),
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        modal.close();
        await mutate(() => api(`/board/publish/${track}`, { method: 'POST', body: { revision } }).then(() => toast(`${TRACKS[track].name} is published.`)));
      } }, `Publish ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`)),
  ]);
}

function newGroupDialog() {
  const input = h('input', { class: 'input', maxLength: 80, required: true, 'aria-label': 'Group name', placeholder: S.track === 'bands' ? 'A working name is fine' : 'Project or group name' });
  const track = S.track;
  const modal = dialog([
    h('form', { method: 'dialog', onsubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return input.focus();
      modal.close();
      mutate(() => api('/board/groups', { method: 'POST', body: { track, name } }));
    } },
      h('h2', {}, `New ${TRACKS[track].name} group`),
      input,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Cancel'), h('button', { class: 'btn primary' }, 'Create'))),
  ]);
  input.focus();
}

function accessDialog() {
  const input = h('input', { class: 'input', type: 'email', 'aria-label': 'Email address', placeholder: 'name@example.com' });
  const err = h('p', { class: 'error', hidden: true });
  const draw = () => dialog([
    h('h2', {}, 'Board access'),
    h('p', {}, 'People with these emails can see every answer, edit groups, and publish. Each person signs up with that email as usual.'),
    h('ul', { class: 'review' }, S.data.board.map((email) => h('li', { style: 'display:flex;justify-content:space-between;gap:10px' }, email,
      email.toLowerCase() === S.me.email.toLowerCase() ? h('span', { class: 'muted' }, 'You') : h('button', { class: 'link-btn', type: 'button', onclick: async () => {
        try {
          await api('/board/access', { method: 'DELETE', body: { email } });
          await refresh();
          draw();
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      } }, 'Remove')))),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('/board/access', { method: 'POST', body: { email: input.value } });
        input.value = '';
        err.hidden = true;
        await refresh();
        draw();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    } }, h('div', { class: 'place-row' }, input, h('button', { class: 'btn' }, 'Add'))),
    err,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => $('modal').close() }, 'Done')),
  ]);
  draw();
}

$('modal').addEventListener('click', (e) => {
  if (e.target === $('modal')) $('modal').close();
});

// ---------- Toast ----------

let toastTimer;
function toast(text, action) {
  const t = toastEl;
  t.replaceChildren(h('span', {}, text), action ? h('button', { class: 'link-btn', type: 'button', onclick: () => {
    t.hidden = true;
    action.run();
  } }, action.label) : '');
  // A toast under an open modal dialog would be unreachable, so it moves into the top layer with it.
  const host = $('drawer').open ? $('drawer') : document.body;
  if (t.parentElement !== host) host.append(t);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}

// ---------- Start ----------

$('new-group').addEventListener('click', newGroupDialog);
$('access').addEventListener('click', accessDialog);
$('search').addEventListener('input', (e) => {
  S.query = e.target.value.trim();
  renderPool();
});
$('f-part').addEventListener('change', (e) => {
  S.part = e.target.value;
  renderPool();
});
$('f-day').addEventListener('change', (e) => {
  S.day = e.target.value;
  renderPool();
});
document.addEventListener('visibilitychange', () => !document.hidden && S.data && poll());

async function start() {
  const me = await api('/me');
  if (!me.user) return location.replace('/join/#signin');
  S.me = me.user;
  if (!me.user.isBoard) {
    $('fatal').textContent = 'This page is for the Sonorum Board. Your account does not have board access.';
    $('fatal').hidden = false;
    return;
  }
  S.data = await api('/board/state');
  $('app').hidden = false;
  renderAll();
  setInterval(poll, POLL_MS);
}

start().catch((err) => {
  $('fatal').textContent = err.message;
  $('fatal').hidden = false;
});
