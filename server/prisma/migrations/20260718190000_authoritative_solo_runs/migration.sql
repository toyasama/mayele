CREATE TABLE "solo_runs" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "client_run_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "mode" TEXT NOT NULL,
  "game" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "practice_skill" TEXT,
  "duration_seconds" INTEGER NOT NULL,
  "question_count" INTEGER NOT NULL,
  "per_question_time_limit_seconds" INTEGER,
  "question_seed" TEXT NOT NULL,
  "current_question_index" INTEGER NOT NULL DEFAULT 0,
  "question_started_at" TIMESTAMP(3) NOT NULL,
  "correct_answers" INTEGER NOT NULL DEFAULT 0,
  "total_questions" INTEGER NOT NULL DEFAULT 0,
  "score_points" INTEGER NOT NULL DEFAULT 0,
  "current_streak" INTEGER NOT NULL DEFAULT 0,
  "best_streak" INTEGER NOT NULL DEFAULT 0,
  "total_response_time_ms" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3),
  "session_id" TEXT,
  "result" JSONB,

  CONSTRAINT "solo_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "solo_run_answers" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "question_index" INTEGER NOT NULL,
  "prompt" TEXT NOT NULL,
  "correct_answer" INTEGER NOT NULL,
  "user_answer" INTEGER,
  "response_time_ms" INTEGER NOT NULL,
  "is_correct" BOOLEAN NOT NULL,
  "game" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "skill" TEXT NOT NULL,
  "answered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "solo_run_answers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "solo_runs_player_id_client_run_id_key" ON "solo_runs"("player_id", "client_run_id");
CREATE UNIQUE INDEX "solo_runs_session_id_key" ON "solo_runs"("session_id");
CREATE INDEX "solo_runs_player_id_status_started_at_idx" ON "solo_runs"("player_id", "status", "started_at" DESC);
CREATE INDEX "solo_runs_status_expires_at_idx" ON "solo_runs"("status", "expires_at");
CREATE UNIQUE INDEX "solo_run_answers_run_id_question_index_key" ON "solo_run_answers"("run_id", "question_index");
CREATE INDEX "solo_run_answers_run_id_answered_at_idx" ON "solo_run_answers"("run_id", "answered_at");

ALTER TABLE "solo_runs"
  ADD CONSTRAINT "solo_runs_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solo_runs"
  ADD CONSTRAINT "solo_runs_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "solo_run_answers"
  ADD CONSTRAINT "solo_run_answers_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "solo_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solo_runs"
  ADD CONSTRAINT "solo_runs_status_check"
  CHECK ("status" IN ('active', 'finalizing', 'completed', 'abandoned', 'expired'));

ALTER TABLE "solo_runs"
  ADD CONSTRAINT "solo_runs_mode_check"
  CHECK ("mode" IN ('sprint', 'tempo'));

ALTER TABLE "solo_runs"
  ADD CONSTRAINT "solo_runs_progress_check"
  CHECK (
    "duration_seconds" BETWEEN 1 AND 3600
    AND "question_count" BETWEEN 1 AND 120
    AND "current_question_index" BETWEEN 0 AND 120
    AND "correct_answers" >= 0
    AND "total_questions" >= 0
    AND "score_points" >= 0
    AND "current_streak" >= 0
    AND "best_streak" >= 0
    AND "total_response_time_ms" >= 0
  );
