-- Keep at most one pending request for an unordered player pair before
-- installing the concurrency invariant. Older history rows remain intact.
WITH ranked_pending AS (
    SELECT "id",
           ROW_NUMBER() OVER (
               PARTITION BY LEAST("sender_id", "receiver_id"), GREATEST("sender_id", "receiver_id")
               ORDER BY "created_at" ASC, "id" ASC
           ) AS row_number
    FROM "friend_requests"
    WHERE "status" = 'pending'
)
UPDATE "friend_requests" AS request
SET "status" = 'cancelled',
    "responded_at" = COALESCE(request."responded_at", CURRENT_TIMESTAMP)
FROM ranked_pending
WHERE request."id" = ranked_pending."id"
  AND ranked_pending.row_number > 1;

CREATE UNIQUE INDEX "friend_requests_one_pending_pair_idx"
ON "friend_requests" (
    LEAST("sender_id", "receiver_id"),
    GREATEST("sender_id", "receiver_id")
)
WHERE "status" = 'pending';
