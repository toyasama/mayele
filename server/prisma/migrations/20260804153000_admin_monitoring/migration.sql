CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_clerk_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_player_id" TEXT,
    "target_clerk_user_id" TEXT,
    "target_label" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_created_at_idx"
ON "admin_audit_logs"("created_at" DESC);

CREATE INDEX "admin_audit_logs_actor_clerk_user_id_created_at_idx"
ON "admin_audit_logs"("actor_clerk_user_id", "created_at" DESC);
