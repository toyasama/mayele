ALTER TABLE "game_sessions" RENAME COLUMN "points" TO "xp";
ALTER TABLE "daily_stats" RENAME COLUMN "points" TO "xp";

ALTER TABLE "players" ADD COLUMN "total_xp" INTEGER NOT NULL DEFAULT 0;

UPDATE "players"
SET "total_xp" = COALESCE(
  (
    SELECT SUM("xp")
    FROM "game_sessions"
    WHERE "game_sessions"."player_id" = "players"."id"
  ),
  0
);
