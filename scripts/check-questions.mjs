// Run with: npm run check
import assert from 'node:assert/strict';
import { LOCKED, SECTIONS, cleanSections, findQuestion, validateAnswers } from '../public/assets/questions.js';

const asSent = (sections) => sections.map((s) => ({ id: s.id, questions: s.questions.map((q) => ({ ...q, options: q.options?.map((o) => o.label) })) }));

// Saving the defaults unchanged keeps every id and option value.
assert.deepEqual(cleanSections(asSent(SECTIONS), SECTIONS), SECTIONS);

// Rewording keeps ids; a renamed option gets a new value; a new question gets a fresh id.
const edited = asSent(SECTIONS);
const about = edited.find((s) => s.id === 'about').questions;
about.find((q) => q.id === 'year').label = 'Class year';
about.find((q) => q.id === 'commitment').options = ['Under 1 hour', 'Lots'];
about.push({ type: 'multi', label: 'Favourite venues', options: ['Kemper', 'Kemper', 'Online'] });
const out = cleanSections(edited, SECTIONS);
assert.equal(findQuestion(out, 'year').label, 'Class year');
assert.deepEqual(findQuestion(out, 'commitment').options, [{ value: 'under_1_hour', label: 'Under 1 hour' }, { value: 'lots', label: 'Lots' }]);
const added = out.find((s) => s.id === 'about').questions.at(-1);
assert.match(added.id, /^q_/);
assert.deepEqual(added.options.map((o) => o.value), ['kemper', 'online']);

// Sorting questions cannot be removed, retyped or made private.
for (const id of LOCKED) {
  const without = asSent(SECTIONS).map((s) => ({ ...s, questions: s.questions.filter((q) => q.id !== id) }));
  assert.throws(() => cleanSections(without, SECTIONS), /cannot be removed/);
}
const retyped = asSent(SECTIONS);
const parts = retyped.find((s) => s.id === 'bands').questions.find((q) => q.id === 'parts');
Object.assign(parts, { type: 'text', boardOnly: true });
const kept = findQuestion(cleanSections(retyped, SECTIONS), 'parts');
assert.equal(kept.type, 'levels');
assert.equal(kept.boardOnly, undefined);

// A question cannot be copied into another section.
const moved = asSent(SECTIONS);
moved.find((s) => s.id === 'create').questions.push(moved.find((s) => s.id === 'bands').questions[0]);
assert.throws(() => cleanSections(moved, SECTIONS), /move between sections/);

// Answers to a removed option are dropped, which makes a required question empty again.
const { missing } = validateAnswers(out, { commitment: '3_to_4_hours' }, []);
assert.ok(missing.includes('commitment'));

console.log('questions: all checks passed');
