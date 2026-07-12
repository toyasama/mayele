CREATE TABLE "mission_completions" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "mission_key" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL DEFAULT 'lifetime',
  "xp_awarded" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mission_completions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mission_completions_player_id_mission_key_scope_key_key"
  ON "mission_completions"("player_id", "mission_key", "scope_key");

CREATE INDEX "mission_completions_player_id_completed_at_idx"
  ON "mission_completions"("player_id", "completed_at" DESC);

ALTER TABLE "mission_completions"
  ADD CONSTRAINT "mission_completions_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
