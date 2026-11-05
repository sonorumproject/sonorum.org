-- Accounts. A user only exists as "signed in" once their email is verified.
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name         TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  password_salt     TEXT NOT NULL,
  password_iters    INTEGER NOT NULL,
  email_verified_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Only hashes of tokens are stored, so a database leak cannot be replayed.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  expires_at TEXT NOT NULL
);

-- Board access is by verified email address.
CREATE TABLE board_members (
  email    TEXT PRIMARY KEY COLLATE NOCASE,
  added_by TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Questionnaire answers. submitted_at is null while still a draft; drafts are hidden from the board.
CREATE TABLE member_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_bands     INTEGER NOT NULL DEFAULT 0,
  in_create    INTEGER NOT NULL DEFAULT 0,
  answers      TEXT NOT NULL DEFAULT '{}',
  submitted_at TEXT,
  updated_at   TEXT NOT NULL
);

-- Draft groups: readable and writable by the board only.
CREATE TABLE groups (
  id         TEXT PRIMARY KEY,
  track      TEXT NOT NULL CHECK (track IN ('bands','create')),
  name       TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX groups_track ON groups(track);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user ON group_members(user_id);

-- Private board notes on a member. Never sent to members.
CREATE TABLE board_notes (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  note       TEXT NOT NULL DEFAULT '',
  archived   INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- What members can actually see. A frozen copy, so later draft edits cannot leak.
CREATE TABLE publications (
  track        TEXT PRIMARY KEY CHECK (track IN ('bands','create')),
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL,
  snapshot     TEXT NOT NULL
);

-- Bumped on every change the board can see; lets board tabs poll cheaply and stay in sync.
CREATE TABLE board_revision (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  revision   INTEGER NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);
INSERT INTO board_revision (id, revision) VALUES (1, 0);
