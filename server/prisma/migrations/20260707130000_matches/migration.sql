CREATE TABLE "matches" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "challenge_mode" TEXT NOT NULL DEFAULT 'speed',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "game" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "practice_skill" TEXT,
  "duration_seconds" INTEGER NOT NULL DEFAULT 60,
  "question_count" INTEGER,
  "per_question_time_limit_seconds" INTEGER,
  "question_seed" TEXT,
  "created_by_id" TEXT NOT NULL,
  "winner_player_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),

  CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_participants" (
  "id" TEXT NOT NULL,
  "match_id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'invited',
  "score" INTEGER,
  "xp" INTEGER,
  "session_id" TEXT,
  "joined_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),

  CONSTRAINT "match_participants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "matches_created_by_id_created_at_idx" ON "matches"("created_by_id", "created_at" DESC);
CREATE INDEX "matches_status_created_at_idx" ON "matches"("status", "created_at" DESC);
CREATE UNIQUE INDEX "match_participants_session_id_key" ON "match_participants"("session_id");
CREATE UNIQUE INDEX "match_participants_match_id_player_id_key" ON "match_participants"("match_id", "player_id");
CREATE INDEX "match_participants_player_id_status_idx" ON "match_participants"("player_id", "status");

ALTER TABLE "matches" ADD CONSTRAINT "matches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
