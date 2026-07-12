CREATE TABLE "friend_requests" (
  "id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "receiver_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at" TIMESTAMP(3),
  CONSTRAINT "friend_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "friendships" (
  "id" TEXT NOT NULL,
  "player_a_id" TEXT NOT NULL,
  "player_b_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "friend_requests_sender_id_receiver_id_key" ON "friend_requests"("sender_id", "receiver_id");
CREATE INDEX "friend_requests_receiver_id_status_idx" ON "friend_requests"("receiver_id", "status");
CREATE INDEX "friend_requests_sender_id_status_idx" ON "friend_requests"("sender_id", "status");
CREATE UNIQUE INDEX "friendships_player_a_id_player_b_id_key" ON "friendships"("player_a_id", "player_b_id");
CREATE INDEX "friendships_player_b_id_idx" ON "friendships"("player_b_id");

ALTER TABLE "friend_requests"
  ADD CONSTRAINT "friend_requests_sender_id_fkey"
  FOREIGN KEY ("sender_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "friend_requests"
  ADD CONSTRAINT "friend_requests_receiver_id_fkey"
  FOREIGN KEY ("receiver_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "friendships"
  ADD CONSTRAINT "friendships_player_a_id_fkey"
  FOREIGN KEY ("player_a_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "friendships"
  ADD CONSTRAINT "friendships_player_b_id_fkey"
  FOREIGN KEY ("player_b_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
