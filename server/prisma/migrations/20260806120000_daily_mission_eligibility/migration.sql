ALTER TABLE "game_sessions"
ADD COLUMN "mission_day" TEXT,
ADD COLUMN "mission_eligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "play_context" TEXT,
ADD COLUMN "challenge_mode" TEXT,
ADD COLUMN "configured_duration_seconds" INTEGER,
ADD COLUMN "configured_question_count" INTEGER,
ADD COLUMN "configured_question_seconds" INTEGER,
ADD COLUMN "valid_answers" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "daily_mission_assignments" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "mission_key" TEXT NOT NULL,
  "catalog_version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_mission_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_mission_assignments_player_id_day_tier_key"
ON "daily_mission_assignments"("player_id", "day", "tier");

CREATE INDEX "daily_mission_assignments_player_id_day_idx"
ON "daily_mission_assignments"("player_id", "day");

CREATE INDEX "game_sessions_player_id_mission_day_mission_eligible_idx"
ON "game_sessions"("player_id", "mission_day", "mission_eligible");

ALTER TABLE "daily_mission_assignments"
ADD CONSTRAINT "daily_mission_assignments_player_id_fkey"
FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_mission_assignments"
ADD CONSTRAINT "daily_mission_assignments_tier_check"
CHECK ("tier" IN ('easy', 'medium', 'hard'));

ALTER TABLE "game_sessions"
ADD CONSTRAINT "game_sessions_play_context_check"
CHECK ("play_context" IS NULL OR "play_context" IN ('solo', 'multiplayer')),
ADD CONSTRAINT "game_sessions_challenge_mode_check"
CHECK ("challenge_mode" IS NULL OR "challenge_mode" IN ('sprint', 'tempo'));

WITH "answer_totals" AS (
  SELECT
    "game_sessions"."id" AS "session_id",
    COUNT("answers"."id") FILTER (WHERE "answers"."user_answer" IS NOT NULL)::INTEGER AS "valid_answers"
  FROM "game_sessions"
  LEFT JOIN "answers" ON "answers"."session_id" = "game_sessions"."id"
  GROUP BY "game_sessions"."id"
)
UPDATE "game_sessions"
SET "valid_answers" = "answer_totals"."valid_answers"
FROM "answer_totals"
WHERE "game_sessions"."id" = "answer_totals"."session_id";

-- Authoritative Solo runs retain the exact configured mode and duration.
UPDATE "game_sessions"
SET
  "mission_day" = to_char(
    "game_sessions"."played_at" AT TIME ZONE 'UTC' AT TIME ZONE "players"."time_zone",
    'YYYY-MM-DD'
  ),
  "mission_eligible" = (
    "game_sessions"."valid_answers" >= 1
    AND "solo_runs"."status" = 'completed'
    AND "solo_runs"."finished_at" IS NOT NULL
    AND (
      (
        "solo_runs"."mode" = 'sprint'
        AND "solo_runs"."finished_at" >= "solo_runs"."ends_at"
      )
      OR (
        "solo_runs"."mode" = 'tempo'
        AND "solo_runs"."question_count" > 0
        AND "solo_runs"."current_question_index" >= "solo_runs"."question_count"
      )
    )
  ),
  "play_context" = 'solo',
  "challenge_mode" = "solo_runs"."mode",
  "configured_duration_seconds" = CASE WHEN "solo_runs"."mode" = 'sprint' THEN "solo_runs"."duration_seconds" ELSE NULL END,
  "configured_question_count" = CASE WHEN "solo_runs"."mode" = 'tempo' THEN "solo_runs"."question_count" ELSE NULL END,
  "configured_question_seconds" = CASE WHEN "solo_runs"."mode" = 'tempo' THEN "solo_runs"."per_question_time_limit_seconds" ELSE NULL END
FROM "solo_runs", "players"
WHERE "solo_runs"."session_id" = "game_sessions"."id"
  AND "players"."id" = "game_sessions"."player_id";

-- Multiplayer facts are participant-specific: an opponent's forfeit never
-- creates an eligible session for the winner.
UPDATE "game_sessions"
SET
  "mission_day" = to_char(
    "game_sessions"."played_at" AT TIME ZONE 'UTC' AT TIME ZONE "players"."time_zone",
    'YYYY-MM-DD'
  ),
  "mission_eligible" = (
    "game_sessions"."valid_answers" >= 1
    AND "match_participants"."status" = 'completed'
    AND "match_participants"."forfeited_at" IS NULL
    AND "match_participants"."finished_at" IS NOT NULL
    AND (
      (
        "matches"."challenge_mode" = 'sprint'
        AND "matches"."started_at" IS NOT NULL
        AND "match_participants"."finished_at"
          >= "matches"."started_at" + make_interval(secs => "matches"."duration_seconds")
      )
      OR (
        "matches"."challenge_mode" = 'tempo'
        AND "matches"."question_count" > 0
        AND "match_participants"."total_questions" = "matches"."question_count"
      )
    )
  ),
  "play_context" = 'multiplayer',
  "challenge_mode" = "matches"."challenge_mode",
  "configured_duration_seconds" = CASE WHEN "matches"."challenge_mode" = 'sprint' THEN "matches"."duration_seconds" ELSE NULL END,
  "configured_question_count" = CASE WHEN "matches"."challenge_mode" = 'tempo' THEN "matches"."question_count" ELSE NULL END,
  "configured_question_seconds" = CASE WHEN "matches"."challenge_mode" = 'tempo' THEN "matches"."per_question_time_limit_seconds" ELSE NULL END
FROM "match_participants", "matches", "players"
WHERE "match_participants"."session_id" = "game_sessions"."id"
  AND "matches"."id" = "match_participants"."match_id"
  AND "players"."id" = "game_sessions"."player_id";
