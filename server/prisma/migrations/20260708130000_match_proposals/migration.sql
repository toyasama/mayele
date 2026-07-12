ALTER TABLE "matches"
  ALTER COLUMN "challenge_mode" DROP DEFAULT,
  ALTER COLUMN "challenge_mode" DROP NOT NULL,
  ALTER COLUMN "game" DROP NOT NULL,
  ALTER COLUMN "level" DROP NOT NULL;

ALTER TABLE "match_participants"
  ADD COLUMN "preferred_challenge_mode" TEXT,
  ADD COLUMN "preferred_game" TEXT,
  ADD COLUMN "preferred_level" TEXT;
