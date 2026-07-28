CREATE TABLE "xp_ledger_entries" (
  "id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "xp_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "xp_ledger_entries_player_id_source_type_source_id_key"
  ON "xp_ledger_entries"("player_id", "source_type", "source_id");
CREATE INDEX "xp_ledger_entries_player_id_created_at_idx"
  ON "xp_ledger_entries"("player_id", "created_at" DESC);

ALTER TABLE "xp_ledger_entries"
  ADD CONSTRAINT "xp_ledger_entries_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "xp_ledger_entries"
  ADD CONSTRAINT "xp_ledger_entries_amount_check" CHECK ("amount" <> 0);

INSERT INTO "xp_ledger_entries" (
  "id",
  "player_id",
  "source_type",
  "source_id",
  "amount",
  "metadata"
)
SELECT
  'xp_bootstrap_' || "id",
  "id",
  'historical_bootstrap',
  'pre-v6-balance',
  "total_xp",
  jsonb_build_object('reason', 'Solde antérieur au registre XP V6')
FROM "players"
WHERE "total_xp" <> 0;

CREATE TABLE "outbox_events" (
  "id" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");
CREATE INDEX "outbox_events_status_available_at_created_at_idx"
  ON "outbox_events"("status", "available_at", "created_at");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_created_at_idx"
  ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_status_check"
  CHECK ("status" IN ('pending', 'processing', 'published', 'failed'));

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0);
