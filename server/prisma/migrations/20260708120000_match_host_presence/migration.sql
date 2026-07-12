ALTER TABLE "matches"
  ADD COLUMN "host_active_at" TIMESTAMP(3);

UPDATE "matches"
SET "host_active_at" = "created_at"
WHERE "status" IN ('pending', 'accepted', 'in_progress');

CREATE INDEX "matches_host_active_at_idx" ON "matches"("host_active_at");
