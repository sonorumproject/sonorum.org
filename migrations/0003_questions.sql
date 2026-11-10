-- The questionnaire as the board last edited it. With no row, the defaults in public/assets/questions.js apply.
CREATE TABLE question_set (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  sections   TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
