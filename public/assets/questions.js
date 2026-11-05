// The sorting questionnaire. Used by the member form, the board panel, and server validation.
// To change a question, edit it here. Ids are stored with answers, so avoid renaming ids once people have answered.

export const TRACKS = {
  bands: { name: 'sonorumBands', blurb: 'Get placed in a band, rehearse, and play shows.' },
  create: { name: 'sonorumCreate', blurb: 'Write, produce, and release songs with other people.' },
};

// Shown wherever someone agrees to us storing their information.
// If the meaning changes, change CONSENT_VERSION too, so the database shows who agreed to which wording.
export const CONSENT_VERSION = '2026-11-05';
export const CONSENT_TEXT = 'I agree that Sonorum can store my name, email, and answers to sort members into groups. The Board and the people who run the site’s hosting can see this information. Once groups are released, my group can see my name, email, and what I play or do. To have my information deleted, I can email hello@sonorum.org.';

export const LEVELS = [
  { value: 'learning', label: 'Learning' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'strong', label: 'Strong' },
];

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const TIMES = [
  { value: 'aft', label: 'Afternoon' },
  { value: 'eve', label: 'Evening' },
];

const list = (...labels) => labels.map((label) => ({ value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label }));

export const SECTIONS = [
  {
    id: 'about',
    title: 'About you',
    questions: [
      { id: 'year', label: 'Year', type: 'single', required: true, options: list('Junior', 'Lower', 'Upper', 'Senior', 'Post-grad') },
      { id: 'availability', label: 'When are you usually free?', help: 'Pick every time you could regularly meet.', type: 'slots', required: true },
      { id: 'commitment', label: 'How much time can you give each week?', type: 'single', required: true, options: list('Under 1 hour', '1 to 2 hours', '3 to 4 hours', '5 hours or more') },
      { id: 'genres', label: 'What do you want to play or write?', type: 'multi', required: true, options: list('Pop', 'Rock', 'Indie', 'R&B / Soul', 'Hip-hop', 'Jazz', 'Country / Folk', 'Metal / Punk', 'Electronic', 'Classical', 'Anything') },
      { id: 'influences', label: 'Artists you love right now', type: 'text', placeholder: 'A few names is plenty' },
    ],
  },
  {
    id: 'bands',
    track: 'bands',
    title: 'sonorumBands',
    questions: [
      { id: 'parts', label: 'What do you play, and how well?', help: 'Only mark what you would actually play in a band.', type: 'levels', required: true, options: list('Vocals', 'Guitar', 'Bass', 'Drums', 'Keys', 'Horns / Winds', 'Strings') },
      { id: 'other_part', label: 'Anything else you play?', type: 'text' },
      { id: 'band_experience', label: 'How much have you played with other people?', type: 'single', required: true, options: list('Never yet', 'A little', 'In a band before', 'Regular shows') },
      { id: 'material', label: 'What should your band play?', type: 'single', required: true, options: list('Covers', 'Originals', 'Both') },
      { id: 'gear', label: 'Gear you can bring', type: 'multi', options: list('Drum kit', 'Amp', 'Keyboard', 'Microphone', 'None') },
      { id: 'band_with', label: 'Anyone you would like to play with?', help: 'If you already have a band, name everyone in it.', type: 'text' },
      { id: 'band_private', label: 'Anything the board should know?', help: 'Only the board sees this. Your group never will.', type: 'textarea', boardOnly: true },
    ],
  },
  {
    id: 'create',
    track: 'create',
    title: 'sonorumCreate',
    questions: [
      { id: 'roles', label: 'What do you do, and how well?', help: 'Only mark what you want to do on a project.', type: 'levels', required: true, options: list('Lyrics', 'Melody', 'Production', 'Arranging', 'Mixing', 'Performing') },
      { id: 'tools', label: 'What do you make music with?', type: 'multi', options: list('Logic', 'Ableton', 'FL Studio', 'GarageBand', 'Pro Tools', 'Instrument and voice memos', 'None yet') },
      { id: 'create_experience', label: 'How much have you finished?', type: 'single', required: true, options: list('Nothing yet', 'Some demos', 'A few full songs', 'Released music') },
      { id: 'work_style', label: 'How do you like to work?', type: 'single', required: true, options: list('Solo, with feedback', 'With one partner', 'In a small group', 'No preference') },
      { id: 'project', label: 'What do you want to make this year?', type: 'textarea' },
      { id: 'links', label: 'Link to your work', help: 'Optional. SoundCloud, Spotify, a Drive folder.', type: 'text', placeholder: 'https://' },
      { id: 'create_with', label: 'Anyone you would like to work with?', type: 'text' },
      { id: 'create_private', label: 'Anything the board should know?', help: 'Only the board sees this. Your group never will.', type: 'textarea', boardOnly: true },
    ],
  },
];

export const slotValues = () => DAYS.flatMap((d) => TIMES.map((t) => `${d.toLowerCase()}_${t.value}`));

export const slotLabel = (slot) => {
  const [day, time] = slot.split('_');
  return `${day[0].toUpperCase()}${day.slice(1)} ${TIMES.find((t) => t.value === time)?.label.toLowerCase() ?? ''}`;
};

export const sectionsFor = (tracks) => SECTIONS.filter((s) => !s.track || tracks.includes(s.track));

export const findOption = (questionId, value) => {
  for (const section of SECTIONS) {
    const q = section.questions.find((x) => x.id === questionId);
    if (q) return q.options?.find((o) => o.value === value)?.label ?? value;
  }
  return value;
};

// What a track's group needs covered, and which answer holds it.
export const COVERAGE = {
  bands: { question: 'parts', core: ['vocals', 'guitar', 'bass', 'drums'] },
  create: { question: 'roles', core: ['lyrics', 'melody', 'production'] },
};

/** Checks answers against the questions. Returns { clean, missing }, keeping only known answers. */
export function validateAnswers(answers, tracks) {
  const clean = {};
  const missing = [];
  for (const section of sectionsFor(tracks)) {
    for (const q of section.questions) {
      const raw = answers?.[q.id];
      let value;
      if (q.type === 'single') {
        if (q.options.some((o) => o.value === raw)) value = raw;
      } else if (q.type === 'multi') {
        if (Array.isArray(raw)) value = raw.filter((v) => q.options.some((o) => o.value === v));
      } else if (q.type === 'slots') {
        if (Array.isArray(raw)) value = raw.filter((v) => slotValues().includes(v));
      } else if (q.type === 'levels') {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          value = {};
          for (const o of q.options) if (LEVELS.some((l) => l.value === raw[o.value])) value[o.value] = raw[o.value];
        }
      } else if (typeof raw === 'string') {
        value = raw.trim().slice(0, q.type === 'textarea' ? 2000 : 300);
      }
      const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Object.keys(value).length);
      if (!empty) clean[q.id] = value;
      else if (q.required) missing.push(q.id);
    }
  }
  return { clean, missing };
}
