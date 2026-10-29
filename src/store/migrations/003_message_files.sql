-- Files attached to a message (Teams `properties.files`), as a JSON array of MessageFile.
ALTER TABLE messages ADD COLUMN files TEXT NOT NULL DEFAULT '[]';

-- Stored messages lack files and image placeholders in `text`; let "history fetch" walk each conversation again to refresh them.
UPDATE checkpoints SET history_complete = 0 WHERE scope != 'conversations';
