-- A nullable key keeps legacy V1 submissions valid while making every V2
-- client command unique within its authenticated player account.
ALTER TABLE game_sessions
  ADD COLUMN submission_key TEXT,
  ADD COLUMN submission_payload_hash TEXT,
  ADD COLUMN submission_result JSONB;

CREATE UNIQUE INDEX game_sessions_player_id_submission_key_key
  ON game_sessions(player_id, submission_key);
