ALTER TABLE "players"
  ADD COLUMN "presence_status" TEXT NOT NULL DEFAULT 'online',
  ADD COLUMN "presence_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "players_presence_status_idx" ON "players"("presence_status");
