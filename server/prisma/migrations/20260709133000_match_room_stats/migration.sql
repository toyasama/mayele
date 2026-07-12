ALTER TABLE "matches" ADD COLUMN "room_id" TEXT;

UPDATE "matches" SET "room_id" = "id" WHERE "room_id" IS NULL;

CREATE INDEX "matches_room_id_created_at_idx" ON "matches"("room_id", "created_at" DESC);
