CREATE TABLE "job_leases" (
    "job_key" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "locked_until" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_leases_pkey" PRIMARY KEY ("job_key")
);

CREATE INDEX "job_leases_locked_until_idx" ON "job_leases"("locked_until");
