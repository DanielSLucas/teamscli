-- Reactions of a message (Teams `properties.emotions`): JSON [{ key, emoji, users: [{ id, reactedAt }] }].
ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '[]';

-- Stored messages lack their reactions; let "history fetch" walk each conversation again to refresh them.
UPDATE checkpoints SET history_complete = 0 WHERE scope != 'conversations';
