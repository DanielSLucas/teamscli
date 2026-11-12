-- Reply quote of a message (Teams `<blockquote itemtype="http://schema.skype.com/Reply">`): JSON { id, senderId, senderName, text }.
ALTER TABLE messages ADD COLUMN quote TEXT;

-- Stored replies still have the quote inside `text`; let "history fetch" walk each conversation again to refresh them.
UPDATE checkpoints SET history_complete = 0 WHERE scope != 'conversations';
