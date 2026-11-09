-- The "customer group" with a margin is really a price list dealer. Keep its data under the new name;
-- customers get a plain customer group instead (their old link pointed at dealers and is dropped).

-- Customers no longer point at dealers
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_groupId_fkey";
DROP INDEX "Customer_groupId_idx";
ALTER TABLE "Customer" DROP COLUMN "groupId";

-- CustomerGroup -> PriceListDealer
ALTER TABLE "CustomerGroup" RENAME TO "PriceListDealer";
ALTER TABLE "PriceListDealer" RENAME CONSTRAINT "CustomerGroup_pkey" TO "PriceListDealer_pkey";
ALTER TABLE "PriceListDealer" RENAME CONSTRAINT "chk_CustomerGroup_marginPercent" TO "chk_PriceListDealer_marginPercent";
ALTER INDEX "CustomerGroup_code_key" RENAME TO "PriceListDealer_code_key";
ALTER INDEX "CustomerGroup_name_idx" RENAME TO "PriceListDealer_name_idx";
ALTER INDEX "CustomerGroup_name_trgm_idx" RENAME TO "PriceListDealer_name_trgm_idx";

-- UserCustomerGroup -> UserPriceListDealer
ALTER TABLE "UserCustomerGroup" RENAME TO "UserPriceListDealer";
ALTER TABLE "UserPriceListDealer" RENAME COLUMN "groupId" TO "dealerId";
ALTER TABLE "UserPriceListDealer" RENAME CONSTRAINT "UserCustomerGroup_pkey" TO "UserPriceListDealer_pkey";
ALTER TABLE "UserPriceListDealer" RENAME CONSTRAINT "UserCustomerGroup_userId_fkey" TO "UserPriceListDealer_userId_fkey";
ALTER TABLE "UserPriceListDealer" RENAME CONSTRAINT "UserCustomerGroup_groupId_fkey" TO "UserPriceListDealer_dealerId_fkey";
ALTER INDEX "UserCustomerGroup_groupId_idx" RENAME TO "UserPriceListDealer_dealerId_idx";

-- Plain customer group
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerGroup_code_key" ON "CustomerGroup"("code");
CREATE INDEX "CustomerGroup_name_idx" ON "CustomerGroup"("name");
CREATE INDEX "CustomerGroup_name_trgm_idx" ON "CustomerGroup" USING GIN ("name" gin_trgm_ops);
ALTER TABLE "Customer" ADD COLUMN "customerGroupId" TEXT;
CREATE INDEX "Customer_customerGroupId_idx" ON "Customer"("customerGroupId");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Publish toggle on costings
ALTER TABLE "Costing" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "publishedById" TEXT;
-- only an approved costing can be on the price list
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_published_approved" CHECK (NOT "published" OR "status" = 'APPROVED');

-- Dealer prices
CREATE TABLE "CostingDealerPrice" (
    "id" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "marginPercent" DECIMAL(9,4) NOT NULL,
    "markupAmount" DECIMAL(18,2) NOT NULL,
    "sellingPrice" DECIMAL(18,2) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "profitPercent" DECIMAL(9,2) NOT NULL,
    "announcedUnitPrice" DECIMAL(18,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostingDealerPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CostingDealerPrice_costingId_dealerId_key" ON "CostingDealerPrice"("costingId", "dealerId");
CREATE INDEX "CostingDealerPrice_dealerId_idx" ON "CostingDealerPrice"("dealerId");
ALTER TABLE "CostingDealerPrice" ADD CONSTRAINT "CostingDealerPrice_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "Costing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostingDealerPrice" ADD CONSTRAINT "CostingDealerPrice_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "PriceListDealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostingDealerPrice" ADD CONSTRAINT "chk_CostingDealerPrice_amounts" CHECK ("marginPercent" >= 0 AND "markupAmount" >= 0 AND "sellingPrice" >= 0 AND "unitPrice" >= 0);
