import { COVERAGE, TRACKS, findOption, validateAnswers } from '../public/assets/questions.js';

const SESSION_COOKIE = 'sonorum_session';
const SESSION_DAYS = 30;
const PBKDF2_ITERS = 100000; // the most Workers' WebCrypto allows
const TOKEN_HOURS = { verify: 48, reset: 2 };

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const now = () => new Date().toISOString();
const later = (ms) => new Date(Date.now() + ms).toISOString();
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: b64(await derive(password, salt, PBKDF2_ITERS)), salt: b64(salt), iters: PBKDF2_ITERS };
}

async function passwordMatches(password, user) {
  const bits = new Uint8Array(await derive(password, unb64(user.password_salt), user.password_iters));
  const stored = unb64(user.password_hash);
  if (bits.length !== stored.length) return false;
  return crypto.subtle.timingSafeEqual ? crypto.subtle.timingSafeEqual(bits, stored) : bits.every((b, i) => b === stored[i]);
}

const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const normalEmail = (e) => e.trim().toLowerCase();

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 10) throw new HttpError(400, 'Use a password of at least 10 characters.');
  if (p.length > 200) throw new HttpError(400, 'That password is too long.');
}

function cleanName(s, label, max = 80) {
  const v = typeof s === 'string' ? s.trim() : '';
  if (!v) throw new HttpError(400, `${label} is required.`);
  return v.slice(0, max);
}

async function limit(env, request, scope) {
  if (!env.AUTH_LIMIT) return;
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const { success } = await env.AUTH_LIMIT.limit({ key: `${scope}:${ip}` });
  if (!success) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
}

async function checkTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET) return;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token || '');
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const out = await res.json();
  if (!out.success) throw new HttpError(400, 'Could not confirm you are human. Please try again.');
}

// ---------- Email ----------

async function sendEmail(env, to, subject, text, html) {
  if (env.DEV_LOG_EMAIL) {
    console.log(`[dev email] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  await env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: 'Sonorum Project' }, subject, text, html });
}

async function issueToken(env, userId, purpose) {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?').bind(userId, purpose),
    env.DB.prepare('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), userId, purpose, later(TOKEN_HOURS[purpose] * 3600e3)),
  ]);
  return token;
}

async function consumeToken(env, token, purpose) {
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'That link is not valid.');
  const row = await env.DB.prepare('DELETE FROM email_tokens WHERE token_hash = ? AND purpose = ? RETURNING user_id, expires_at').bind(await sha256(token), purpose).first();
  if (!row || row.expires_at < now()) throw new HttpError(400, 'That link has expired. Please request a new one.');
  return row.user_id;
}

const mailHtml = (intro, url, label) =>
  `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.5;color:#000"><p>${intro}</p><p><a href="${url}" style="color:#B24D2E">${label}</a></p><p style="color:#7a7a7a">Sonorum Project</p></div>`;

async function sendVerify(env, origin, user) {
  const token = await issueToken(env, user.id, 'verify');
  const url = `${origin}/account/#verify=${token}`;
  const intro = 'Confirm your email to finish creating your Sonorum account.';
  await sendEmail(env, user.email, 'Confirm your Sonorum account', `${intro}\n\n${url}\n\nThis link lasts 48 hours.`, mailHtml(intro, url, 'Confirm my email'));
}

async function sendReset(env, origin, user) {
  const token = await issueToken(env, user.id, 'reset');
  const url = `${origin}/join/#reset=${token}`;
  const intro = 'Someone asked to reset your Sonorum password. If it was not you, ignore this email.';
  await sendEmail(env, user.email, 'Reset your Sonorum password', `${intro}\n\n${url}\n\nThis link lasts 2 hours.`, mailHtml(intro, url, 'Choose a new password'));
}

// ---------- Sessions ----------

function sessionCookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function startSession(env, request, userId) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, later(SESSION_DAYS * 864e5)).run();
  return sessionCookie(request, token, SESSION_DAYS * 86400);
}

function readCookie(request) {
  const match = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]+)`));
  return match?.[1];
}

async function currentUser(env, request) {
  const token = readCookie(request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email, u.full_name, b.email IS NOT NULL AS is_board
     FROM sessions s JOIN users u ON u.id = s.user_id
     LEFT JOIN board_members b ON b.email = u.email
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.email_verified_at IS NOT NULL`,
  ).bind(await sha256(token), now()).first();
}

async function requireUser(env, request) {
  const user = await currentUser(env, request);
  if (!user) throw new HttpError(401, 'Please sign in.');
  return user;
}

async function requireBoard(env, request) {
  const user = await requireUser(env, request);
  if (!user.is_board) throw new HttpError(403, 'Board access only.');
  return user;
}

// ---------- Auth routes ----------

async function signup(env, request, body, origin) {
  await limit(env, request, 'signup');
  await checkTurnstile(env, body.turnstileToken, request);
  if (!validEmail(body.email)) throw new HttpError(400, 'Enter a valid email address.');
  checkPassword(body.password);
  const fullName = cleanName(body.fullName, 'Your name');
  const email = normalEmail(body.email);

  const existing = await env.DB.prepare('SELECT id, email, email_verified_at FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    // Same answer as a new account, so sign-up cannot be used to probe who has joined.
    if (!existing.email_verified_at) await sendVerify(env, origin, existing);
    return json({ ok: true });
  }
  const { hash, salt, iters } = await hashPassword(body.password);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, full_name, password_hash, password_salt, password_iters) VALUES (?, ?, ?, ?, ?, ?)').bind(id, email, fullName, hash, salt, iters).run();
  await sendVerify(env, origin, { id, email });
  return json({ ok: true });
}

async function login(env, request, body, origin) {
  await limit(env, request, 'login');
  const bad = new HttpError(400, 'That email and password do not match.');
  if (!validEmail(body.email) || typeof body.password !== 'string') throw bad;
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(normalEmail(body.email)).first();
  if (!user || !(await passwordMatches(body.password, user))) throw bad;
  if (!user.email_verified_at) {
    await sendVerify(env, origin, user);
    throw new HttpError(403, 'Confirm your email first. We just sent a new link.');
  }
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, request, user.id) });
}

async function verify(env, request, body) {
  const userId = await consumeToken(env, body.token, 'verify');
  await env.DB.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').bind(now(), userId).run();
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, request, userId) });
}

async function forgot(env, request, body, origin) {
  await limit(env, request, 'forgot');
  if (validEmail(body.email)) {
    const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(normalEmail(body.email)).first();
    if (user) await sendReset(env, origin, user);
  }
  return json({ ok: true });
}

async function reset(env, request, body) {
  await limit(env, request, 'reset');
  checkPassword(body.password);
  const userId = await consumeToken(env, body.token, 'reset');
  const { hash, salt, iters } = await hashPassword(body.password);
  await env.DB.batch([
    // Reaching this link proves control of the email, so it also counts as verifying it.
    env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').bind(hash, salt, iters, now(), userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
  ]);
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, request, userId) });
}

async function logout(env, request) {
  const token = readCookie(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
}

// ---------- Member routes ----------

const profileTracks = (p) => [p?.in_bands ? 'bands' : null, p?.in_create ? 'create' : null].filter(Boolean);

async function getMe(env, request) {
  const user = await currentUser(env, request);
  if (!user) return json({ user: null });
  const profile = await env.DB.prepare('SELECT * FROM member_profiles WHERE user_id = ?').bind(user.id).first();
  const { results: pubs } = await env.DB.prepare('SELECT track, published_at, snapshot FROM publications').all();

  // Members only ever get their own groups out of the frozen copy.
  const groups = [];
  for (const pub of pubs) {
    for (const g of JSON.parse(pub.snapshot).groups) {
      if (g.members.some((m) => m.id === user.id)) {
        groups.push({ track: pub.track, name: g.name, publishedAt: pub.published_at, members: g.members.map(({ name, email, parts }) => ({ name, email, parts })) });
      }
    }
  }
  return json({
    user: { id: user.id, email: user.email, name: user.full_name, isBoard: !!user.is_board },
    profile: profile ? { tracks: profileTracks(profile), answers: JSON.parse(profile.answers), submittedAt: profile.submitted_at, updatedAt: profile.updated_at } : null,
    release: { published: pubs.map((p) => p.track), groups },
  });
}

async function saveProfile(env, request, body) {
  const user = await requireUser(env, request);
  const tracks = (Array.isArray(body.tracks) ? body.tracks : []).filter((t) => t in TRACKS);
  const { clean, missing } = validateAnswers(body.answers, tracks);
  const submitting = !!body.submit;
  if (submitting) {
    if (!tracks.length) throw new HttpError(400, 'Choose sonorumBands, sonorumCreate, or both.');
    if (missing.length) throw new HttpError(400, 'A few required questions are still empty.', { missing });
  }
  const encoded = JSON.stringify(clean);
  if (encoded.length > 32768) throw new HttpError(400, 'Those answers are too long.');

  const prior = await env.DB.prepare('SELECT in_bands, in_create, submitted_at FROM member_profiles WHERE user_id = ?').bind(user.id).first();
  const wasSubmitted = !!prior?.submitted_at;
  if (wasSubmitted && !submitting && (!tracks.length || missing.length)) {
    // Already with the board: an autosave must not leave them holding an incomplete profile.
    throw new HttpError(400, 'A few required questions are still empty.', { missing });
  }
  const ts = now();
  const submittedAt = submitting ? prior?.submitted_at || ts : prior?.submitted_at || null;
  const statements = [
    env.DB.prepare(
      `INSERT INTO member_profiles (user_id, in_bands, in_create, answers, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET in_bands = excluded.in_bands, in_create = excluded.in_create, answers = excluded.answers, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at`,
    ).bind(user.id, tracks.includes('bands') ? 1 : 0, tracks.includes('create') ? 1 : 0, encoded, submittedAt, ts),
  ];
  // Leaving a track takes them out of that track's draft groups.
  for (const track of Object.keys(TRACKS)) {
    if (!tracks.includes(track)) {
      statements.push(env.DB.prepare('DELETE FROM group_members WHERE user_id = ? AND group_id IN (SELECT id FROM groups WHERE track = ?)').bind(user.id, track));
    }
  }
  if (submittedAt) statements.push(bump(env, user.email));
  await env.DB.batch(statements);
  return json({ ok: true, submittedAt, updatedAt: ts });
}

// ---------- Board routes ----------

const bump = (env, actor) => env.DB.prepare('UPDATE board_revision SET revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = 1').bind(actor, now());
const readRevision = (env) => env.DB.prepare('SELECT revision, updated_by, updated_at FROM board_revision WHERE id = 1').first();

async function boardState(env) {
  const [rev, members, groups, placements, pubs, board] = await env.DB.batch([
    env.DB.prepare('SELECT revision, updated_by, updated_at FROM board_revision WHERE id = 1'),
    env.DB.prepare(
      `SELECT u.id, u.email, u.full_name, p.in_bands, p.in_create, p.answers, p.submitted_at, p.updated_at,
              n.note, COALESCE(n.archived, 0) AS archived, n.updated_by AS note_by
       FROM member_profiles p JOIN users u ON u.id = p.user_id LEFT JOIN board_notes n ON n.user_id = u.id
       WHERE p.submitted_at IS NOT NULL ORDER BY u.full_name COLLATE NOCASE`,
    ),
    env.DB.prepare('SELECT id, track, name, notes, created_at FROM groups ORDER BY created_at'),
    env.DB.prepare('SELECT group_id, user_id FROM group_members ORDER BY added_at'),
    env.DB.prepare('SELECT track, published_at, published_by, snapshot FROM publications'),
    env.DB.prepare('SELECT email, added_by FROM board_members ORDER BY email'),
  ]);
  const { draftCount } = await env.DB.prepare('SELECT COUNT(*) AS draftCount FROM member_profiles WHERE submitted_at IS NULL').first();
  const r = rev.results[0];
  return {
    revision: r.revision,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
    draftCount,
    members: members.results.map((m) => ({
      id: m.id,
      email: m.email,
      name: m.full_name,
      tracks: profileTracks(m),
      answers: JSON.parse(m.answers),
      submittedAt: m.submitted_at,
      updatedAt: m.updated_at,
      note: m.note || '',
      archived: !!m.archived,
    })),
    groups: groups.results.map((g) => ({ ...g, memberIds: placements.results.filter((p) => p.group_id === g.id).map((p) => p.user_id) })),
    publications: Object.fromEntries(pubs.results.map((p) => [p.track, { publishedAt: p.published_at, publishedBy: p.published_by, snapshot: JSON.parse(p.snapshot) }])),
    board: board.results.map((b) => b.email),
  };
}

const groupTrack = async (env, id) => {
  const g = await env.DB.prepare('SELECT track FROM groups WHERE id = ?').bind(id).first();
  if (!g) throw new HttpError(404, 'That group no longer exists. Someone may have just deleted it.');
  return g.track;
};

async function createGroup(env, user, body) {
  if (!(body.track in TRACKS)) throw new HttpError(400, 'Unknown track.');
  const id = crypto.randomUUID();
  const ts = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO groups (id, track, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, body.track, cleanName(body.name, 'A group name'), user.email, ts, ts),
    bump(env, user.email),
  ]);
  return json({ id });
}

async function updateGroup(env, user, id, body) {
  await groupTrack(env, id);
  const name = body.name === undefined ? null : cleanName(body.name, 'A group name');
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;
  await env.DB.batch([
    env.DB.prepare('UPDATE groups SET name = COALESCE(?, name), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?').bind(name, notes, now(), id),
    bump(env, user.email),
  ]);
  return json({ ok: true });
}

async function deleteGroup(env, user, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM group_members WHERE group_id = ?').bind(id), env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id), bump(env, user.email)]);
  return json({ ok: true });
}

/** One call covers move (from + to), double-up (to only) and back to the pool (from only). */
async function place(env, user, body) {
  const { userId, fromGroupId, toGroupId } = body;
  if (typeof userId !== 'string' || (!fromGroupId && !toGroupId)) throw new HttpError(400, 'Nothing to change.');
  const statements = [];
  if (toGroupId) {
    const track = await groupTrack(env, toGroupId);
    if (fromGroupId && (await groupTrack(env, fromGroupId)) !== track) throw new HttpError(400, 'Groups are in different tracks.');
    const member = await env.DB.prepare('SELECT in_bands, in_create, submitted_at FROM member_profiles WHERE user_id = ?').bind(userId).first();
    if (!member?.submitted_at || !profileTracks(member).includes(track)) throw new HttpError(400, 'This person has not signed up for that track.');
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)').bind(toGroupId, userId, user.email, now()));
  }
  if (fromGroupId && fromGroupId !== toGroupId) statements.push(env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(fromGroupId, userId));
  await env.DB.batch([...statements, bump(env, user.email)]);
  return json({ ok: true });
}

async function saveNote(env, user, userId, body) {
  const note = typeof body.note === 'string' ? body.note.slice(0, 4000) : null;
  const archived = typeof body.archived === 'boolean' ? (body.archived ? 1 : 0) : null;
  const statements = [
    env.DB.prepare(
      `INSERT INTO board_notes (user_id, note, archived, updated_by, updated_at) VALUES (?1, COALESCE(?2, ''), COALESCE(?3, 0), ?4, ?5)
       ON CONFLICT(user_id) DO UPDATE SET note = COALESCE(?2, note), archived = COALESCE(?3, archived), updated_by = ?4, updated_at = ?5`,
    ).bind(userId, note, archived, user.email, now()),
  ];
  if (archived) statements.push(env.DB.prepare('DELETE FROM group_members WHERE user_id = ?').bind(userId));
  statements.push(bump(env, user.email));
  await env.DB.batch(statements);
  return json({ ok: true });
}

/** The only fields about a person that ever reach other members. */
function publicParts(answers, track) {
  const held = answers[COVERAGE[track].question] || {};
  const rank = { strong: 0, comfortable: 1, learning: 2 };
  return Object.keys(held).sort((a, b) => rank[held[a]] - rank[held[b]]).map((v) => findOption(COVERAGE[track].question, v));
}

async function publish(env, user, track, body) {
  if (!(track in TRACKS)) throw new HttpError(404, 'Unknown track.');
  const rev = await readRevision(env);
  // What the board reviewed in the dialog must be exactly what goes out.
  if (body.revision !== rev.revision) throw new HttpError(409, 'Someone changed the groups while you were reviewing. Check them again.');

  const [groups, rows] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM groups WHERE track = ? ORDER BY created_at').bind(track),
    env.DB.prepare(
      `SELECT gm.group_id, u.id, u.full_name, u.email, p.answers FROM group_members gm
       JOIN groups g ON g.id = gm.group_id JOIN users u ON u.id = gm.user_id JOIN member_profiles p ON p.user_id = u.id
       WHERE g.track = ? ORDER BY gm.added_at`,
    ).bind(track),
  ]);
  const snapshot = {
    groups: groups.results
      .map((g) => ({
        id: g.id,
        name: g.name,
        members: rows.results.filter((r) => r.group_id === g.id).map((r) => ({ id: r.id, name: r.full_name, email: r.email, parts: publicParts(JSON.parse(r.answers), track) })),
      }))
      .filter((g) => g.members.length),
  };
  if (!snapshot.groups.length) throw new HttpError(400, 'There are no groups with people in them yet.');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO publications (track, published_at, published_by, snapshot) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(track) DO UPDATE SET published_at = ?2, published_by = ?3, snapshot = ?4`,
    ).bind(track, now(), user.email, JSON.stringify(snapshot)),
    bump(env, user.email),
  ]);
  return json({ ok: true });
}

async function unpublish(env, user, track) {
  await env.DB.batch([env.DB.prepare('DELETE FROM publications WHERE track = ?').bind(track), bump(env, user.email)]);
  return json({ ok: true });
}

async function addBoard(env, user, body) {
  if (!validEmail(body.email)) throw new HttpError(400, 'Enter a valid email address.');
  await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO board_members (email, added_by) VALUES (?, ?)').bind(normalEmail(body.email), user.email), bump(env, user.email)]);
  return json({ ok: true });
}

async function removeBoard(env, user, body) {
  if (typeof body.email !== 'string') throw new HttpError(400, 'Enter a valid email address.');
  if (normalEmail(body.email) === normalEmail(user.email)) throw new HttpError(400, 'You cannot remove your own access. Ask another board member.');
  await env.DB.batch([env.DB.prepare('DELETE FROM board_members WHERE email = ?').bind(normalEmail(body.email)), bump(env, user.email)]);
  return json({ ok: true });
}

// ---------- Router ----------

async function handleApi(request, env) {
  const url = new URL(request.url);
  const { pathname: path, origin } = url;
  const method = request.method;
  let body = {};

  if (method !== 'GET') {
    // A cross-site page cannot set this origin or send JSON without a preflight we never approve.
    const from = request.headers.get('origin');
    if (from && from !== origin) throw new HttpError(403, 'Bad origin.');
    if (!(request.headers.get('content-type') || '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
    body = await request.json().catch(() => {
      throw new HttpError(400, 'Could not read that request.');
    });
    if (!body || typeof body !== 'object') body = {};
  }

  const route = `${method} ${path}`;
  switch (route) {
    case 'GET /api/config':
      return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null });
    case 'POST /api/auth/signup':
      return signup(env, request, body, origin);
    case 'POST /api/auth/login':
      return login(env, request, body, origin);
    case 'POST /api/auth/verify':
      return verify(env, request, body);
    case 'POST /api/auth/forgot':
      return forgot(env, request, body, origin);
    case 'POST /api/auth/reset':
      return reset(env, request, body);
    case 'POST /api/auth/logout':
      return logout(env, request);
    case 'GET /api/me':
      return getMe(env, request);
    case 'PUT /api/me/profile':
      return saveProfile(env, request, body);
  }

  if (path.startsWith('/api/board/')) {
    const user = await requireBoard(env, request);
    const parts = path.split('/').slice(3).map(decodeURIComponent);
    const [a, b] = parts;
    if (method === 'GET' && a === 'revision') return json(await readRevision(env));
    if (method === 'GET' && a === 'state') return json(await boardState(env));
    if (method === 'POST' && a === 'groups' && !b) return createGroup(env, user, body);
    if (method === 'PATCH' && a === 'groups' && b) return updateGroup(env, user, b, body);
    if (method === 'DELETE' && a === 'groups' && b) return deleteGroup(env, user, b);
    if (method === 'POST' && a === 'place') return place(env, user, body);
    if (method === 'PUT' && a === 'notes' && b) return saveNote(env, user, b, body);
    if (method === 'POST' && a === 'publish' && b) return publish(env, user, b, body);
    if (method === 'POST' && a === 'unpublish' && b) return unpublish(env, user, b);
    if (method === 'POST' && a === 'access') return addBoard(env, user, body);
    if (method === 'DELETE' && a === 'access') return removeBoard(env, user, body);
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    try {
      return await handleApi(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong on our end. Please try again.' }, 500);
    }
  },
};
