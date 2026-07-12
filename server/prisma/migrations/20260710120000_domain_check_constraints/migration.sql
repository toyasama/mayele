ALTER TABLE players
  ADD CONSTRAINT players_presence_status_check
  CHECK (presence_status IN ('online', 'away', 'busy', 'offline'));

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('friend_request_received', 'friend_request_accepted', 'match_invite_received', 'match_invite_accepted', 'match_invite_declined')),
  ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('active', 'dismissed'));

ALTER TABLE friend_requests
  ADD CONSTRAINT friend_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'));

ALTER TABLE matches
  ADD CONSTRAINT matches_type_check
  CHECK (type IN ('challenge')),
  ADD CONSTRAINT matches_challenge_mode_check
  CHECK (challenge_mode IS NULL OR challenge_mode IN ('sprint', 'tempo')),
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('pending', 'accepted', 'ready', 'in_progress', 'completed', 'cancelled', 'expired')),
  ADD CONSTRAINT matches_game_check
  CHECK (game IS NULL OR game IN ('addition', 'soustraction', 'multiplication', 'division', 'mixte')),
  ADD CONSTRAINT matches_level_check
  CHECK (level IS NULL OR level IN ('debutant', 'intermediaire', 'avance', 'expert')),
  ADD CONSTRAINT matches_practice_skill_check
  CHECK (practice_skill IS NULL OR practice_skill IN ('addition', 'soustraction', 'multiplication', 'division', 'retenues', 'emprunts', 'tables', 'calcul_rapide', 'mixte'));

ALTER TABLE match_participants
  ADD CONSTRAINT match_participants_status_check
  CHECK (status IN ('invited', 'accepted', 'declined', 'ready', 'playing', 'submitting', 'completed', 'disconnected')),
  ADD CONSTRAINT match_participants_preferred_challenge_mode_check
  CHECK (preferred_challenge_mode IS NULL OR preferred_challenge_mode IN ('sprint', 'tempo')),
  ADD CONSTRAINT match_participants_preferred_game_check
  CHECK (preferred_game IS NULL OR preferred_game IN ('addition', 'soustraction', 'multiplication', 'division', 'mixte')),
  ADD CONSTRAINT match_participants_preferred_level_check
  CHECK (preferred_level IS NULL OR preferred_level IN ('debutant', 'intermediaire', 'avance', 'expert'));

ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_game_check
  CHECK (game IN ('addition', 'soustraction', 'multiplication', 'division', 'mixte')),
  ADD CONSTRAINT game_sessions_level_check
  CHECK (level IN ('debutant', 'intermediaire', 'avance', 'expert')),
  ADD CONSTRAINT game_sessions_practice_skill_check
  CHECK (practice_skill IS NULL OR practice_skill IN ('addition', 'soustraction', 'multiplication', 'division', 'retenues', 'emprunts', 'tables', 'calcul_rapide', 'mixte'));

ALTER TABLE answers
  ADD CONSTRAINT answers_game_check
  CHECK (game IN ('addition', 'soustraction', 'multiplication', 'division', 'mixte')),
  ADD CONSTRAINT answers_level_check
  CHECK (level IN ('debutant', 'intermediaire', 'avance', 'expert')),
  ADD CONSTRAINT answers_skill_check
  CHECK (skill IN ('addition', 'soustraction', 'multiplication', 'division', 'retenues', 'emprunts', 'tables', 'calcul_rapide', 'mixte'));

ALTER TABLE match_question_answers
  ADD CONSTRAINT match_question_answers_skill_check
  CHECK (skill IN ('addition', 'soustraction', 'multiplication', 'division', 'retenues', 'emprunts', 'tables', 'calcul_rapide', 'mixte'));
