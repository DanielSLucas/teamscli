-- Original sender and send time of a forwarded message (Teams `properties.originalMessageContext`).
ALTER TABLE messages ADD COLUMN forwarded_from_id TEXT;
ALTER TABLE messages ADD COLUMN forwarded_sent_at TEXT;

-- Stored forwards lack their origin; let "history fetch" walk each conversation again to refresh them.
UPDATE checkpoints SET history_complete = 0 WHERE scope != 'conversations';
