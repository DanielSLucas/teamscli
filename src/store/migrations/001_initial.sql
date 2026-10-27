-- Schema for one account. Timestamps are ISO 8601 UTC text; ids are Teams ids, verbatim.

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
) STRICT;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'group', 'meeting', 'channel', 'system')),
  title TEXT,
  -- No foreign key: a channel can be seen in the conversation list before its team is synced.
  team_id TEXT,
  last_message_at TEXT
) STRICT;

CREATE INDEX conversations_by_team ON conversations (team_id) WHERE team_id IS NOT NULL;

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  email TEXT
) STRICT;

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  role TEXT,
  PRIMARY KEY (conversation_id, person_id)
) STRICT, WITHOUT ROWID;

-- Message ids are unique only within a conversation. The implicit rowid backs the FTS index.
CREATE TABLE messages (
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  parent_id TEXT,
  sender_id TEXT,
  sender_name TEXT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  version INTEGER NOT NULL,
  client_message_id TEXT,
  UNIQUE (conversation_id, id)
) STRICT;

CREATE INDEX messages_by_time ON messages (conversation_id, created_at);
CREATE INDEX messages_by_parent ON messages (conversation_id, parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX messages_by_sender ON messages (sender_id);

-- Full-text search over messages.text, accent-insensitive ("mensal" matches "mênsal").
CREATE VIRTUAL TABLE messages_fts USING fts5 (
  text,
  content = 'messages',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;

-- scope: 'conversations' for the conversation list, otherwise a conversation id.
CREATE TABLE checkpoints (
  scope TEXT PRIMARY KEY,
  sync_state TEXT,
  backward_link TEXT,
  oldest_message_at TEXT,
  history_complete INTEGER NOT NULL DEFAULT 0 CHECK (history_complete IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;
