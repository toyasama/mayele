CREATE INDEX "answers_player_id_game_level_is_correct_response_time_ms_idx"
  ON "answers"("player_id", "game", "level", "is_correct", "response_time_ms");
