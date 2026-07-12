ALTER TABLE "matches"
  ADD COLUMN "expires_at" TIMESTAMP(3);

UPDATE "matches"
SET "expires_at" = COALESCE("started_at", "created_at") + interval '30 minutes';

ALTER TABLE "matches"
  ALTER COLUMN "expires_at" SET NOT NULL,
  ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + interval '30 minutes');

CREATE INDEX "matches_expires_at_idx" ON "matches"("expires_at");
