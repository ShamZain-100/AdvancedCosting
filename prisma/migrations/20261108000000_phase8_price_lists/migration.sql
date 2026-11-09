-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "status" "PriceListStatus" NOT NULL DEFAULT 'DRAFT',
    "costBase" TEXT NOT NULL,
    "gstTreatment" TEXT NOT NULL,
    "roundTo" DECIMAL(18,4),
    "defaultProfitMethod" TEXT NOT NULL DEFAULT 'PERCENT',
    "defaultProfitValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defaultDiscountPercent" DECIMAL(7,4),
    "notes" TEXT,
    "rules" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "costingVersion" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "basicCost" DECIMAL(18,2) NOT NULL,
    "totalCostInclGst" DECIMAL(18,2) NOT NULL,
    "gstPercent" DECIMAL(7,4) NOT NULL,
    "profitMethod" TEXT NOT NULL,
    "profitValue" DECIMAL(18,4) NOT NULL,
    "discountPercent" DECIMAL(7,4),
    "discountAmount" DECIMAL(18,2),
    "minPrice" DECIMAL(18,2),
    "maxPrice" DECIMAL(18,2),
    "notes" TEXT,
    "costBaseAmount" DECIMAL(18,2) NOT NULL,
    "profitAmount" DECIMAL(18,2) NOT NULL,
    "listPriceExGst" DECIMAL(18,2) NOT NULL,
    "gstAmount" DECIMAL(18,2) NOT NULL,
    "listPriceInclGst" DECIMAL(18,2) NOT NULL,
    "sellingPrice" DECIMAL(18,2) NOT NULL,
    "discountApplied" DECIMAL(18,2) NOT NULL,
    "effectivePrice" DECIMAL(18,2) NOT NULL,
    "effectiveExGst" DECIMAL(18,2) NOT NULL,
    "effectiveInclGst" DECIMAL(18,2) NOT NULL,
    "effectiveProfit" DECIMAL(18,2) NOT NULL,
    "marginPercent" DECIMAL(9,2) NOT NULL,
    "markupPercent" DECIMAL(9,2) NOT NULL,
    "flags" TEXT[],

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_number_key" ON "PriceList"("number");

-- CreateIndex
CREATE INDEX "PriceList_status_idx" ON "PriceList"("status");

-- CreateIndex
CREATE INDEX "PriceList_effectiveDate_idx" ON "PriceList"("effectiveDate");

-- CreateIndex
CREATE INDEX "PriceListItem_costingId_idx" ON "PriceListItem"("costingId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_costingId_key" ON "PriceListItem"("priceListId", "costingId");

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "Costing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

