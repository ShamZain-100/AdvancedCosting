-- CreateEnum
CREATE TYPE "RateChangeSource" AS ENUM ('PURCHASE', 'PURCHASE_DELETED', 'MANUAL', 'IMPORT');

-- CreateTable
CREATE TABLE "PurchaseRate" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierId" TEXT,
    "unitId" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "baseRate" DECIMAL(18,6) NOT NULL,
    "baseQuantity" DECIMAL(18,6) NOT NULL,
    "purchaseDate" DATE NOT NULL,
    "referenceNo" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PurchaseRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRateHistory" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "oldRate" DECIMAL(18,4) NOT NULL,
    "newRate" DECIMAL(18,4) NOT NULL,
    "minRate" DECIMAL(18,4),
    "maxRate" DECIMAL(18,4),
    "avgRate" DECIMAL(18,4),
    "source" "RateChangeSource" NOT NULL,
    "reason" TEXT,
    "impact" JSONB,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportHistory" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "successRows" INTEGER NOT NULL,
    "failedRows" INTEGER NOT NULL,
    "errors" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRate_itemId_purchaseDate_idx" ON "PurchaseRate"("itemId", "purchaseDate");

-- CreateIndex
CREATE INDEX "PurchaseRate_supplierId_idx" ON "PurchaseRate"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseRateHistory_itemId_changedAt_idx" ON "PurchaseRateHistory"("itemId", "changedAt");

-- CreateIndex
CREATE INDEX "PurchaseRateHistory_changedAt_idx" ON "PurchaseRateHistory"("changedAt");

-- CreateIndex
CREATE INDEX "ImportHistory_kind_createdAt_idx" ON "ImportHistory"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "PurchaseRate" ADD CONSTRAINT "PurchaseRate_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRate" ADD CONSTRAINT "PurchaseRate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRate" ADD CONSTRAINT "PurchaseRate_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRateHistory" ADD CONSTRAINT "PurchaseRateHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

