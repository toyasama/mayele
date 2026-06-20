CREATE TABLE "players" (
  "id" TEXT NOT NULL,
  "clerk_user_id" TEXT NOT NULL,
  "email" TEXT,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_sessions" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "game" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "practice_skill" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "points" INTEGER NOT NULL DEFAULT 0,
  "correct_answers" INTEGER NOT NULL DEFAULT 0,
  "total_questions" INTEGER NOT NULL DEFAULT 0,
  "duration_seconds" INTEGER NOT NULL DEFAULT 0,
  "best_streak" INTEGER NOT NULL DEFAULT 0,
  "played_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "answers" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "game" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "skill" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "correct_answer" INTEGER NOT NULL,
  "user_answer" INTEGER NOT NULL,
  "response_time_ms" INTEGER NOT NULL,
  "is_correct" BOOLEAN NOT NULL DEFAULT false,
  "answered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "achievements" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "achievement_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_stats" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "sessions_count" INTEGER NOT NULL DEFAULT 0,
  "points" INTEGER NOT NULL DEFAULT 0,
  "correct_answers" INTEGER NOT NULL DEFAULT 0,
  "total_questions" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "players_clerk_user_id_key" ON "players"("clerk_user_id");
CREATE INDEX "game_sessions_player_id_played_at_idx" ON "game_sessions"("player_id", "played_at" DESC);
CREATE INDEX "game_sessions_player_id_game_level_idx" ON "game_sessions"("player_id", "game", "level");
CREATE INDEX "answers_player_id_skill_idx" ON "answers"("player_id", "skill");
CREATE INDEX "answers_session_id_idx" ON "answers"("session_id");
CREATE UNIQUE INDEX "achievements_player_id_achievement_key_key" ON "achievements"("player_id", "achievement_key");
CREATE UNIQUE INDEX "daily_stats_player_id_day_key" ON "daily_stats"("player_id", "day");

ALTER TABLE "game_sessions"
  ADD CONSTRAINT "game_sessions_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "answers"
  ADD CONSTRAINT "answers_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "answers"
  ADD CONSTRAINT "answers_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "achievements"
  ADD CONSTRAINT "achievements_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_stats"
  ADD CONSTRAINT "daily_stats_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
