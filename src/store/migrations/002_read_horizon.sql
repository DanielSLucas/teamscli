-- Teams `consumptionhorizon`: arrival time of the last message the user has read.
ALTER TABLE conversations ADD COLUMN read_up_to TEXT;

-- The list cursor only returns changed conversations; drop it so the next sync fills read_up_to for all of them once.
DELETE FROM checkpoints WHERE scope = 'conversations';
