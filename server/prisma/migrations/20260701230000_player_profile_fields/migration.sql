ALTER TABLE "players"
  ADD COLUMN "first_name" TEXT,
  ADD COLUMN "last_name" TEXT,
  ADD COLUMN "birth_date" DATE,
  ADD COLUMN "username" TEXT,
  ADD COLUMN "avatar_url" TEXT;

CREATE UNIQUE INDEX "players_username_key" ON "players"("username");
