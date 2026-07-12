CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "actor_player_id" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "title" TEXT NOT NULL,
  "body" TEXT,
  "href" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMP(3),
  "dismissed_at" TIMESTAMP(3),

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_player_id_dedupe_key_key" ON "notifications"("player_id", "dedupe_key");
CREATE INDEX "notifications_player_id_status_created_at_idx" ON "notifications"("player_id", "status", "created_at" DESC);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_player_id_fkey"
  FOREIGN KEY ("actor_player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
