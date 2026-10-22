-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('healthy', 'unhealthy', 'unknown');

-- CreateTable
CREATE TABLE "status_snapshots" (
    "id" SERIAL NOT NULL,
    "service" TEXT NOT NULL,
    "status" "ServiceStatus" NOT NULL,
    "detail" JSONB,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_snapshots_service_recorded_at_idx" ON "status_snapshots"("service", "recorded_at");
