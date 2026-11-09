-- CreateEnum
CREATE TYPE "CostingStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('LIVE', 'SNAPSHOT');

-- CreateEnum
CREATE TYPE "RateBasisKind" AS ENUM ('STANDARD', 'MIN', 'MAX', 'AVERAGE', 'SUPPLIER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WastageMode" AS ENUM ('PERCENT', 'QUANTITY');

-- CreateTable
CREATE TABLE "NumberSequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CostingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CostingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Costing" (
    "id" TEXT NOT NULL,
    "costingNumber" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "typeId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" INTEGER,
    "description" TEXT,
    "length" DECIMAL(18,4),
    "width" DECIMAL(18,4),
    "height" DECIMAL(18,4),
    "dimensionUnitId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitId" TEXT,
    "costingDate" DATE NOT NULL,
    "preparedById" TEXT NOT NULL,
    "notes" TEXT,
    "status" "CostingStatus" NOT NULL DEFAULT 'DRAFT',
    "pricingMode" "PricingMode" NOT NULL DEFAULT 'LIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "wastagePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "gstPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "markupPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "rules" JSONB NOT NULL,
    "materialCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "materialWastage" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "labourCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expenseCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "basicCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCostInclGst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "markupAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sellingPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "profitAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "profitPercent" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "netBasicRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netSellingPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Costing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingGroup" (
    "id" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "wastagePercent" DECIMAL(7,4),

    CONSTRAINT "CostingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingCategory" (
    "id" TEXT NOT NULL,
    "costingGroupId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "wastagePercent" DECIMAL(7,4),

    CONSTRAINT "CostingCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingMaterial" (
    "id" TEXT NOT NULL,
    "costingCategoryId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "notes" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitId" TEXT NOT NULL,
    "wastageMode" "WastageMode" NOT NULL DEFAULT 'PERCENT',
    "wastagePercent" DECIMAL(7,4),
    "wastageQuantity" DECIMAL(18,4),
    "rateBasis" "RateBasisKind" NOT NULL DEFAULT 'STANDARD',
    "supplierId" TEXT,
    "rate" DECIMAL(18,4) NOT NULL,
    "itemGstPercent" DECIMAL(7,4),
    "effectiveQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CostingMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingLabour" (
    "id" TEXT NOT NULL,
    "costingGroupId" TEXT NOT NULL,
    "labourId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitId" TEXT,
    "customRate" BOOLEAN NOT NULL DEFAULT false,
    "rate" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CostingLabour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingExpense" (
    "id" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "costingGroupId" TEXT,
    "expenseId" TEXT NOT NULL,
    "calculationMethod" "ExpenseCalcMethod" NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "applyTiming" "GstTiming" NOT NULL DEFAULT 'BEFORE_GST',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CostingExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingRevision" (
    "id" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Costing_costingNumber_key" ON "Costing"("costingNumber");

-- CreateIndex
CREATE INDEX "Costing_typeId_idx" ON "Costing"("typeId");

-- CreateIndex
CREATE INDEX "Costing_status_idx" ON "Costing"("status");

-- CreateIndex
CREATE INDEX "Costing_costingDate_idx" ON "Costing"("costingDate");

-- CreateIndex
CREATE INDEX "Costing_productName_idx" ON "Costing"("productName");

-- CreateIndex
CREATE UNIQUE INDEX "CostingGroup_costingId_groupId_key" ON "CostingGroup"("costingId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "CostingCategory_costingGroupId_categoryId_key" ON "CostingCategory"("costingGroupId", "categoryId");

-- CreateIndex
CREATE INDEX "CostingMaterial_itemId_idx" ON "CostingMaterial"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "CostingRevision_costingId_version_key" ON "CostingRevision"("costingId", "version");

-- AddForeignKey
ALTER TABLE "Costing" ADD CONSTRAINT "Costing_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "Type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Costing" ADD CONSTRAINT "Costing_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Costing" ADD CONSTRAINT "Costing_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingGroup" ADD CONSTRAINT "CostingGroup_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "Costing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingGroup" ADD CONSTRAINT "CostingGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ItemGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingCategory" ADD CONSTRAINT "CostingCategory_costingGroupId_fkey" FOREIGN KEY ("costingGroupId") REFERENCES "CostingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingCategory" ADD CONSTRAINT "CostingCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "CostingMaterial_costingCategoryId_fkey" FOREIGN KEY ("costingCategoryId") REFERENCES "CostingCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "CostingMaterial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "CostingMaterial_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "CostingMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLabour" ADD CONSTRAINT "CostingLabour_costingGroupId_fkey" FOREIGN KEY ("costingGroupId") REFERENCES "CostingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLabour" ADD CONSTRAINT "CostingLabour_labourId_fkey" FOREIGN KEY ("labourId") REFERENCES "Labour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLabour" ADD CONSTRAINT "CostingLabour_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingExpense" ADD CONSTRAINT "CostingExpense_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "Costing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingExpense" ADD CONSTRAINT "CostingExpense_costingGroupId_fkey" FOREIGN KEY ("costingGroupId") REFERENCES "CostingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingExpense" ADD CONSTRAINT "CostingExpense_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingRevision" ADD CONSTRAINT "CostingRevision_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "Costing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

