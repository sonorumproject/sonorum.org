// Local development only. Fills the local D1 database with made-up members so the board can be tried out.
// Everyone's password is the one below. Run: npm run db:seed:local
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PASSWORD = 'sonorum-dev-only';
const ITERS = 100000;
const q = (s) => (s === null ? 'NULL' : `'${String(s).replaceAll("'", "''")}'`);

const slots = (...days) => days.flatMap((d) => [`${d}_aft`, `${d}_eve`]);
const band = (parts, exp, material, genres, days, extra = {}) => ({ tracks: ['bands'], answers: { year: 'upper', commitment: '3_to_4_hours', parts, band_experience: exp, material, genres, availability: slots(...days), ...extra } });
const create = (roles, exp, style, genres, days, extra = {}) => ({ tracks: ['create'], answers: { year: 'lower', commitment: '1_to_2_hours', roles, create_experience: exp, work_style: style, genres, availability: slots(...days), ...extra } });
const both = (a, b) => ({ tracks: ['bands', 'create'], answers: { ...b.answers, ...a.answers } });

const people = [
  ['Avery Lin', band({ vocals: 'strong', keys: 'comfortable' }, 'in_a_band_before', 'both', ['pop', 'indie'], ['mon', 'wed', 'sat'])],
  ['Jordan Reyes', band({ drums: 'strong' }, 'regular_shows', 'originals', ['rock', 'metal_punk'], ['mon', 'tue', 'sat'], { gear: ['drum_kit'] })],
  ['Sam Okafor', band({ bass: 'comfortable', guitar: 'learning' }, 'a_little', 'both', ['rock', 'indie'], ['mon', 'sat'])],
  ['Riley Novak', band({ guitar: 'strong' }, 'in_a_band_before', 'originals', ['rock', 'indie'], ['wed', 'sat'], { gear: ['amp'], band_with: 'Jordan Reyes' })],
  ['Casey Duarte', band({ vocals: 'comfortable', guitar: 'comfortable' }, 'a_little', 'covers', ['country_folk', 'pop'], ['tue', 'thu'])],
  ['Morgan Patel', band({ keys: 'strong', strings: 'comfortable' }, 'in_a_band_before', 'both', ['jazz', 'r_b_soul'], ['tue', 'thu', 'sun'])],
  ['Quinn Abara', band({ drums: 'comfortable' }, 'a_little', 'covers', ['pop', 'r_b_soul'], ['tue', 'sun'])],
  ['Dakota Hale', band({ horns_winds: 'strong' }, 'never_yet', 'both', ['jazz', 'r_b_soul'], ['thu', 'sun'])],
  ['Emerson Vu', band({ bass: 'strong' }, 'regular_shows', 'both', ['jazz', 'rock'], ['tue', 'thu'], { gear: ['amp'], band_private: 'Would rather not be placed with their sibling.' })],
  ['Rowan Sato', band({ vocals: 'learning' }, 'never_yet', 'covers', ['pop'], ['wed', 'sun'])],
  ['Parker Nguyen', band({ guitar: 'comfortable' }, 'a_little', 'covers', ['pop', 'rock'], ['wed', 'sun'])],
  ['Sage Moreno', create({ lyrics: 'strong', melody: 'comfortable' }, 'a_few_full_songs', 'with_one_partner', ['indie', 'pop'], ['mon', 'fri'], { tools: ['garageband'], project: 'A five-song EP about moving away from home.' })],
  ['Blake Ivanov', create({ production: 'strong', mixing: 'comfortable' }, 'released_music', 'in_a_small_group', ['electronic', 'hip_hop'], ['mon', 'fri', 'sat'], { tools: ['ableton'], links: 'https://example.com/blake' })],
  ['Harper Cole', create({ melody: 'strong', performing: 'strong' }, 'some_demos', 'in_a_small_group', ['r_b_soul', 'pop'], ['fri', 'sat'], { tools: ['logic'] })],
  ['Finley Adeyemi', create({ production: 'comfortable' }, 'some_demos', 'no_preference', ['hip_hop'], ['tue', 'thu'], { tools: ['fl_studio'] })],
  ['Reese Tanaka', create({ lyrics: 'comfortable' }, 'nothing_yet', 'solo_with_feedback', ['country_folk'], ['tue', 'thu'], { tools: ['none_yet'] })],
  ['Skyler Brandt', both(band({ guitar: 'strong', vocals: 'comfortable' }, 'in_a_band_before', 'originals', ['indie', 'rock'], ['mon', 'sat']), create({ lyrics: 'comfortable', arranging: 'comfortable' }, 'a_few_full_songs', 'in_a_small_group', ['indie', 'rock'], ['mon', 'sat']))],
  ['Tatum Rossi', both(band({ keys: 'comfortable' }, 'a_little', 'both', ['pop'], ['fri', 'sat']), create({ melody: 'comfortable', production: 'learning' }, 'some_demos', 'with_one_partner', ['pop'], ['fri', 'sat']))],
];

const account = (id, email, name) => {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(PASSWORD, salt, ITERS, 32, 'sha256');
  return `INSERT INTO users (id,email,full_name,password_hash,password_salt,password_iters,email_verified_at) VALUES (${q(id)},${q(email)},${q(name)},${q(hash.toString('base64'))},${q(salt.toString('base64'))},${ITERS},${q(new Date().toISOString())});`;
};

const ts = new Date().toISOString();
const sql = ['DELETE FROM publications; DELETE FROM group_members; DELETE FROM groups; DELETE FROM board_notes; DELETE FROM member_profiles; DELETE FROM sessions; DELETE FROM email_tokens; DELETE FROM users; DELETE FROM board_members;'];
for (const [name, p] of people) {
  const id = randomUUID();
  const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
  sql.push(account(id, email, name));
  sql.push(`INSERT INTO member_profiles (user_id,in_bands,in_create,answers,submitted_at,updated_at) VALUES (${q(id)},${p.tracks.includes('bands') ? 1 : 0},${p.tracks.includes('create') ? 1 : 0},${q(JSON.stringify(p.answers))},${q(ts)},${q(ts)});`);
}
for (const [email, name] of [['board1@example.com', 'Board One'], ['board2@example.com', 'Board Two']]) {
  sql.push(account(randomUUID(), email, name));
  sql.push(`INSERT INTO board_members (email,added_by) VALUES (${q(email)},'seed');`);
}

const file = join(mkdtempSync(join(tmpdir(), 'sonorum-seed-')), 'seed.sql');
writeFileSync(file, sql.join('\n'));
execFileSync('npx', ['wrangler', 'd1', 'execute', 'sonorum', '--local', '--file', file], { stdio: 'inherit' });
console.log(`\nSeeded ${people.length} members. Board sign-ins: board1@example.com and board2@example.com (password in this script).`);
