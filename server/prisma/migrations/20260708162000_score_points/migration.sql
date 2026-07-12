ALTER TABLE "game_sessions" ADD COLUMN "score_points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "match_participants" ADD COLUMN "score_points" INTEGER NOT NULL DEFAULT 0;
