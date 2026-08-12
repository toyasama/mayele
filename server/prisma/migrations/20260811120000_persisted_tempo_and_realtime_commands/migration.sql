ALTER TABLE "matches"
  ADD COLUMN "tempo_question_index" INTEGER,
  ADD COLUMN "tempo_question_started_at" TIMESTAMP(3),
  ADD COLUMN "tempo_question_deadline_at" TIMESTAMP(3);

UPDATE "matches"
SET
  "tempo_question_index" = 0,
  "tempo_question_started_at" = "started_at",
  "tempo_question_deadline_at" = "started_at" + make_interval(secs => "per_question_time_limit_seconds")
WHERE
  "status" = 'in_progress'
  AND "challenge_mode" = 'tempo'
  AND "started_at" IS NOT NULL
  AND "per_question_time_limit_seconds" IS NOT NULL;

CREATE INDEX "matches_status_challenge_mode_tempo_question_deadline_at_idx"
  ON "matches"("status", "challenge_mode", "tempo_question_deadline_at");

CREATE TABLE "realtime_command_receipts" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "match_id" TEXT,
  "event_name" TEXT NOT NULL,
  "command_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "owner_token" TEXT NOT NULL,
  "locked_until" TIMESTAMP(3) NOT NULL,
  "response" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "realtime_command_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "realtime_command_receipts_player_id_event_name_command_id_key"
  ON "realtime_command_receipts"("player_id", "event_name", "command_id");
CREATE INDEX "realtime_command_receipts_status_locked_until_idx"
  ON "realtime_command_receipts"("status", "locked_until");
CREATE INDEX "realtime_command_receipts_match_id_created_at_idx"
  ON "realtime_command_receipts"("match_id", "created_at" DESC);

ALTER TABLE "realtime_command_receipts"
  ADD CONSTRAINT "realtime_command_receipts_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "realtime_command_receipts"
  ADD CONSTRAINT "realtime_command_receipts_match_id_fkey"
  FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "realtime_command_receipts"
  ADD CONSTRAINT "realtime_command_receipts_status_check"
  CHECK ("status" IN ('processing', 'completed'));

CREATE TABLE "socket_io_attachments" (
  "id" BIGSERIAL NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "payload" BYTEA,

  CONSTRAINT "socket_io_attachments_id_key" UNIQUE ("id")
);

CREATE INDEX "socket_io_attachments_created_at_idx"
  ON "socket_io_attachments"("created_at");
