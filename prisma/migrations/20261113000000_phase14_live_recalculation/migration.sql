-- CreateEnum
CREATE TYPE "RecalcKind" AS ENUM ('ITEM_RATE', 'ITEM_GST', 'ITEM_UNITS', 'LABOUR_RATE', 'EXPENSE_DEFAULT', 'RULES');

-- CreateEnum
CREATE TYPE "RecalcBatchStatus" AS ENUM ('PENDING', 'APPLYING', 'PARTIAL', 'APPLIED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RecalcItemStatus" AS ENUM ('APPLIED', 'UNCHANGED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "CostingSettings" ADD COLUMN     "flagThresholdPercent" DECIMAL(7,2) NOT NULL DEFAULT 0,
ADD COLUMN     "recalcMode" TEXT NOT NULL DEFAULT 'CONFIRM';

-- AlterTable
ALTER TABLE "CostingExpense" ADD COLUMN     "overrideFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "RecalculationBatch" (
    "id" TEXT NOT NULL,
    "kind" "RecalcKind" NOT NULL,
    "sourceId" TEXT,
    "sourceName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changePercent" DECIMAL(9,2),
    "status" "RecalcBatchStatus" NOT NULL DEFAULT 'PENDING',
    "costingCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissReason" TEXT,

    CONSTRAINT "RecalculationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecalculationItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "status" "RecalcItemStatus" NOT NULL,
    "reason" TEXT,
    "sellingBefore" DECIMAL(18,2),
    "sellingAfter" DECIMAL(18,2),
    "basicBefore" DECIMAL(18,2),
    "basicAfter" DECIMAL(18,2),
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecalculationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewFlag" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT,
    "priceListId" TEXT,
    "batchId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "ReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecalculationBatch_status_createdAt_idx" ON "RecalculationBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RecalculationBatch_kind_sourceId_status_idx" ON "RecalculationBatch"("kind", "sourceId", "status");

-- CreateIndex
CREATE INDEX "RecalculationItem_batchId_idx" ON "RecalculationItem"("batchId");

-- CreateIndex
CREATE INDEX "RecalculationItem_costingId_idx" ON "RecalculationItem"("costingId");

-- CreateIndex
CREATE INDEX "ReviewFlag_quotationId_resolvedAt_idx" ON "ReviewFlag"("quotationId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ReviewFlag_priceListId_resolvedAt_idx" ON "ReviewFlag"("priceListId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ReviewFlag_batchId_idx" ON "ReviewFlag"("batchId");

-- AddForeignKey
ALTER TABLE "RecalculationItem" ADD CONSTRAINT "RecalculationItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RecalculationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecalculationItem" ADD CONSTRAINT "RecalculationItem_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "Costing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "ReviewFlag_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "ReviewFlag_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "ReviewFlag_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RecalculationBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing costing expenses: a field that differs from today's expense master was an override; the rest follow the master.
UPDATE "CostingExpense" ce SET "overrideFields" = ARRAY_REMOVE(ARRAY[
  CASE WHEN ce."calculationMethod" <> ex."calculationMethod" THEN 'method' END,
  CASE WHEN ce."value" <> ex."defaultValue" THEN 'value' END,
  CASE WHEN ce."applyTiming" <> ex."applyTiming" THEN 'timing' END
], NULL)
FROM "Expense" ex WHERE ex."id" = ce."expenseId";

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written part: database-level rules for the recalculation tables.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "CostingSettings" ADD CONSTRAINT "chk_CostingSettings_recalc_mode" CHECK ("recalcMode" IN ('AUTO', 'CONFIRM', 'MANUAL'));
ALTER TABLE "CostingSettings" ADD CONSTRAINT "chk_CostingSettings_flag_threshold" CHECK ("flagThresholdPercent" >= 0 AND "flagThresholdPercent" <= 100);
ALTER TABLE "RecalculationBatch" ADD CONSTRAINT "chk_RecalculationBatch_counts" CHECK ("costingCount" >= 0 AND "flaggedCount" >= 0 AND "appliedCount" >= 0 AND "skippedCount" >= 0 AND "failedCount" >= 0);
-- A review flag belongs to exactly one document.
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "chk_ReviewFlag_one_target" CHECK (("quotationId" IS NOT NULL AND "priceListId" IS NULL) OR ("quotationId" IS NULL AND "priceListId" IS NOT NULL));
-- At most one open flag per document and source of change.
CREATE UNIQUE INDEX "ReviewFlag_one_open_quotation_idx" ON "ReviewFlag" ("quotationId", "sourceKey") WHERE "quotationId" IS NOT NULL AND "resolvedAt" IS NULL;
CREATE UNIQUE INDEX "ReviewFlag_one_open_pricelist_idx" ON "ReviewFlag" ("priceListId", "sourceKey") WHERE "priceListId" IS NOT NULL AND "resolvedAt" IS NULL;
-- Only one pending recalculation per source of change (further changes update it).
CREATE UNIQUE INDEX "RecalculationBatch_one_pending_idx" ON "RecalculationBatch" ("kind", COALESCE("sourceId", '')) WHERE "status" IN ('PENDING', 'PARTIAL');
