ALTER TABLE "matches"
ADD COLUMN "tempo_question_answer_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "matches" AS m
SET "tempo_question_answer_count" = (
  SELECT COUNT(*)::INTEGER
  FROM "match_question_answers" AS a
  WHERE a."match_id" = m."id"
    AND a."question_index" = COALESCE(m."tempo_question_index", 0)
)
WHERE m."status" = 'in_progress'
  AND m."challenge_mode" = 'tempo'
  AND COALESCE(m."tempo_question_index", 0) < COALESCE(m."question_count", 0);

ALTER TABLE "matches"
ADD CONSTRAINT "matches_tempo_question_answer_count_non_negative"
CHECK ("tempo_question_answer_count" >= 0);
