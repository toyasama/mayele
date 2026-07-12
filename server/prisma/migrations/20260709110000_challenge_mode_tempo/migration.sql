UPDATE "matches"
SET "challenge_mode" = 'tempo'
WHERE "challenge_mode" = 'cadence';

UPDATE "match_participants"
SET "preferred_challenge_mode" = 'tempo'
WHERE "preferred_challenge_mode" = 'cadence';
