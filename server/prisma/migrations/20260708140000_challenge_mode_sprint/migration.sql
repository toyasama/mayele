UPDATE "matches"
SET "challenge_mode" = 'sprint'
WHERE "challenge_mode" = 'speed';

ALTER TABLE "matches"
ALTER COLUMN "challenge_mode" SET DEFAULT 'sprint';

UPDATE "match_participants"
SET "preferred_challenge_mode" = 'sprint'
WHERE "preferred_challenge_mode" = 'speed';
