-- Presence is now derived from authenticated realtime activity, never selected manually.
UPDATE players
SET
  presence_status = 'offline',
  presence_updated_at = CURRENT_TIMESTAMP
WHERE presence_status <> 'offline';

ALTER TABLE players
  ALTER COLUMN presence_status SET DEFAULT 'offline';

ALTER TABLE players
  DROP CONSTRAINT players_presence_status_check,
  ADD CONSTRAINT players_presence_status_check
  CHECK (presence_status IN ('online', 'away', 'offline'));
