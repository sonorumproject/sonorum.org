-- When someone agreed to us storing their information, and which wording they agreed to.
ALTER TABLE users ADD COLUMN consent_at TEXT;
ALTER TABLE users ADD COLUMN consent_version TEXT;
