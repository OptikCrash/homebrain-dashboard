CREATE TABLE "backup_run_snapshots" (
    "id" SERIAL NOT NULL,
    "state" TEXT NOT NULL CHECK ("state" IN ('ok', 'failed', 'skipped')),
    "finished_at" TIMESTAMP(3) NOT NULL,
    "snapshot_id" TEXT,
    "bytes_added" BIGINT,
    "detail" JSONB NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_run_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "backup_run_snapshots_finished_at_key" ON "backup_run_snapshots"("finished_at");
