ALTER TABLE "matches"
ADD COLUMN "tempo_finalization_owner" TEXT,
ADD COLUMN "tempo_finalization_locked_until" TIMESTAMP(3);

CREATE INDEX "matches_status_challenge_mode_tempo_finalization_locked_until_idx"
ON "matches"("status", "challenge_mode", "tempo_finalization_locked_until");
