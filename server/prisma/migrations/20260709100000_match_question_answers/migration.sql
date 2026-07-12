CREATE TABLE "match_question_answers" (
  "id" TEXT NOT NULL,
  "match_id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "question_index" INTEGER NOT NULL,
  "prompt" TEXT NOT NULL,
  "correct_answer" INTEGER NOT NULL,
  "user_answer" INTEGER NOT NULL,
  "response_time_ms" INTEGER NOT NULL,
  "skill" TEXT NOT NULL,
  "answered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "match_question_answers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "match_question_answers_match_id_player_id_question_index_key"
  ON "match_question_answers"("match_id", "player_id", "question_index");

CREATE INDEX "match_question_answers_match_id_question_index_idx"
  ON "match_question_answers"("match_id", "question_index");

ALTER TABLE "match_question_answers"
  ADD CONSTRAINT "match_question_answers_match_id_fkey"
  FOREIGN KEY ("match_id") REFERENCES "matches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "match_question_answers"
  ADD CONSTRAINT "match_question_answers_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
