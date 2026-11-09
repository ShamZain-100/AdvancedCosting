-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- DropForeignKey
ALTER TABLE "Labour" DROP CONSTRAINT "Labour_unitId_fkey";

-- DropForeignKey
ALTER TABLE "Labour" DROP CONSTRAINT "Labour_typeId_fkey";

-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_defaultSupplierId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseRate" DROP CONSTRAINT "PurchaseRate_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "TemplateLabour" DROP CONSTRAINT "TemplateLabour_unitId_fkey";

-- DropForeignKey
ALTER TABLE "Costing" DROP CONSTRAINT "Costing_templateId_fkey";

-- DropForeignKey
ALTER TABLE "CostingMaterial" DROP CONSTRAINT "CostingMaterial_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "CostingLabour" DROP CONSTRAINT "CostingLabour_unitId_fkey";

-- DropForeignKey
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_customerId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationItem" DROP CONSTRAINT "QuotationItem_costingId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationItem" DROP CONSTRAINT "QuotationItem_unitId_fkey";

-- DropIndex
DROP INDEX "PurchaseRate_supplierId_idx";

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "UserPermission_permissionId_idx" ON "UserPermission"("permissionId");

-- CreateIndex
CREATE INDEX "Supplier_name_trgm_idx" ON "Supplier" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Supplier_code_trgm_idx" ON "Supplier" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Labour_unitId_idx" ON "Labour"("unitId");

-- CreateIndex
CREATE INDEX "Labour_typeId_idx" ON "Labour"("typeId");

-- CreateIndex
CREATE INDEX "Item_unitId_idx" ON "Item"("unitId");

-- CreateIndex
CREATE INDEX "Item_defaultSupplierId_idx" ON "Item"("defaultSupplierId");

-- CreateIndex
CREATE INDEX "Item_code_trgm_idx" ON "Item" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Item_name_trgm_idx" ON "Item" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ItemUnitConversion_unitId_idx" ON "ItemUnitConversion"("unitId");

-- CreateIndex
CREATE INDEX "AreaConversion_fromUnitId_idx" ON "AreaConversion"("fromUnitId");

-- CreateIndex
CREATE INDEX "AreaConversion_toUnitId_idx" ON "AreaConversion"("toUnitId");

-- CreateIndex
CREATE INDEX "PurchaseRate_supplierId_itemId_purchaseDate_idx" ON "PurchaseRate"("supplierId", "itemId", "purchaseDate");

-- CreateIndex
CREATE INDEX "PurchaseRate_unitId_idx" ON "PurchaseRate"("unitId");

-- CreateIndex
CREATE INDEX "Template_name_trgm_idx" ON "Template" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "TemplateGroup_groupId_idx" ON "TemplateGroup"("groupId");

-- CreateIndex
CREATE INDEX "TemplateCategory_categoryId_idx" ON "TemplateCategory"("categoryId");

-- CreateIndex
CREATE INDEX "TemplateItem_itemId_idx" ON "TemplateItem"("itemId");

-- CreateIndex
CREATE INDEX "TemplateItem_unitId_idx" ON "TemplateItem"("unitId");

-- CreateIndex
CREATE INDEX "TemplateLabour_templateGroupId_idx" ON "TemplateLabour"("templateGroupId");

-- CreateIndex
CREATE INDEX "TemplateLabour_labourId_idx" ON "TemplateLabour"("labourId");

-- CreateIndex
CREATE INDEX "TemplateLabour_unitId_idx" ON "TemplateLabour"("unitId");

-- CreateIndex
CREATE INDEX "TemplateExpense_templateId_idx" ON "TemplateExpense"("templateId");

-- CreateIndex
CREATE INDEX "TemplateExpense_templateGroupId_idx" ON "TemplateExpense"("templateGroupId");

-- CreateIndex
CREATE INDEX "TemplateExpense_expenseId_idx" ON "TemplateExpense"("expenseId");

-- CreateIndex
CREATE INDEX "Costing_preparedById_idx" ON "Costing"("preparedById");

-- CreateIndex
CREATE INDEX "Costing_templateId_idx" ON "Costing"("templateId");

-- CreateIndex
CREATE INDEX "Costing_deletedAt_costingDate_idx" ON "Costing"("deletedAt", "costingDate");

-- CreateIndex
CREATE INDEX "Costing_productName_trgm_idx" ON "Costing" USING GIN ("productName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Costing_costingNumber_trgm_idx" ON "Costing" USING GIN ("costingNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "CostingGroup_groupId_idx" ON "CostingGroup"("groupId");

-- CreateIndex
CREATE INDEX "CostingCategory_categoryId_idx" ON "CostingCategory"("categoryId");

-- CreateIndex
CREATE INDEX "CostingMaterial_costingCategoryId_idx" ON "CostingMaterial"("costingCategoryId");

-- CreateIndex
CREATE INDEX "CostingMaterial_unitId_idx" ON "CostingMaterial"("unitId");

-- CreateIndex
CREATE INDEX "CostingMaterial_supplierId_idx" ON "CostingMaterial"("supplierId");

-- CreateIndex
CREATE INDEX "CostingLabour_costingGroupId_idx" ON "CostingLabour"("costingGroupId");

-- CreateIndex
CREATE INDEX "CostingLabour_labourId_idx" ON "CostingLabour"("labourId");

-- CreateIndex
CREATE INDEX "CostingLabour_unitId_idx" ON "CostingLabour"("unitId");

-- CreateIndex
CREATE INDEX "CostingExpense_costingId_idx" ON "CostingExpense"("costingId");

-- CreateIndex
CREATE INDEX "CostingExpense_costingGroupId_idx" ON "CostingExpense"("costingGroupId");

-- CreateIndex
CREATE INDEX "CostingExpense_expenseId_idx" ON "CostingExpense"("expenseId");

-- CreateIndex
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Quotation_preparedById_idx" ON "Quotation"("preparedById");

-- CreateIndex
CREATE INDEX "Quotation_deletedAt_quotationDate_idx" ON "Quotation"("deletedAt", "quotationDate");

-- CreateIndex
CREATE INDEX "Quotation_status_validUntil_idx" ON "Quotation"("status", "validUntil");

-- CreateIndex
CREATE INDEX "Quotation_customerName_trgm_idx" ON "Quotation" USING GIN ("customerName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Quotation_number_trgm_idx" ON "Quotation" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "QuotationItem_unitId_idx" ON "QuotationItem"("unitId");

-- CreateIndex
CREATE INDEX "CostingImage_fileId_idx" ON "CostingImage"("fileId");

-- CreateIndex
CREATE INDEX "TemplateImage_fileId_idx" ON "TemplateImage"("fileId");

-- AddForeignKey
ALTER TABLE "Labour" ADD CONSTRAINT "Labour_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Labour" ADD CONSTRAINT "Labour_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "Type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRate" ADD CONSTRAINT "PurchaseRate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateLabour" ADD CONSTRAINT "TemplateLabour_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Costing" ADD CONSTRAINT "Costing_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "CostingMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLabour" ADD CONSTRAINT "CostingLabour_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "Costing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An item-specific conversion rule must not silently become a generic one if its item is removed.
ALTER TABLE "AreaConversion" DROP CONSTRAINT "AreaConversion_itemId_fkey";
ALTER TABLE "AreaConversion" ADD CONSTRAINT "AreaConversion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A company logo file cannot be deleted while it is still the logo.
ALTER TABLE "CompanySettings" DROP CONSTRAINT "CompanySettings_logoFileId_fkey";
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "FileAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written part (Prisma cannot model CHECK constraints or partial indexes).
-- These are enforced by the database in addition to the application's validation,
-- so bad data cannot get in through a script, an import or a future bug.
-- ─────────────────────────────────────────────────────────────────────────────

-- Value ranges. NULL passes a CHECK, so optional columns need no special case.
ALTER TABLE "Item" ADD CONSTRAINT "chk_Item_gstPercent_pct" CHECK ("gstPercent" >= 0 AND "gstPercent" <= 100);
ALTER TABLE "Item" ADD CONSTRAINT "chk_Item_defaultPurchaseRate_nonneg" CHECK ("defaultPurchaseRate" >= 0);
ALTER TABLE "Item" ADD CONSTRAINT "chk_Item_minRate_nonneg" CHECK ("minRate" >= 0);
ALTER TABLE "Item" ADD CONSTRAINT "chk_Item_maxRate_nonneg" CHECK ("maxRate" >= 0);
ALTER TABLE "Item" ADD CONSTRAINT "chk_Item_avgRate_nonneg" CHECK ("avgRate" >= 0);
ALTER TABLE "Item" ADD CONSTRAINT "chk_Item_min_le_max" CHECK ("minRate" <= "maxRate");
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "chk_ItemUnitConversion_conversionValue_pos" CHECK ("conversionValue" > 0);
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "chk_ItemSupplier_rate_nonneg" CHECK ("rate" >= 0);
ALTER TABLE "Unit" ADD CONSTRAINT "chk_Unit_precision_range" CHECK ("decimalPrecision" >= 0 AND "decimalPrecision" <= 6);
ALTER TABLE "Unit" ADD CONSTRAINT "chk_Unit_baseFactor_pos" CHECK ("baseFactor" > 0);
ALTER TABLE "Labour" ADD CONSTRAINT "chk_Labour_defaultRate_nonneg" CHECK ("defaultRate" >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT "chk_Expense_defaultValue_nonneg" CHECK ("defaultValue" >= 0);
ALTER TABLE "AreaConversion" ADD CONSTRAINT "chk_AreaConversion_conversionValue_pos" CHECK ("conversionValue" > 0);
ALTER TABLE "PurchaseRate" ADD CONSTRAINT "chk_PurchaseRate_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseRate" ADD CONSTRAINT "chk_PurchaseRate_baseQuantity_pos" CHECK ("baseQuantity" > 0);
ALTER TABLE "PurchaseRate" ADD CONSTRAINT "chk_PurchaseRate_rate_nonneg" CHECK ("rate" >= 0);
ALTER TABLE "PurchaseRate" ADD CONSTRAINT "chk_PurchaseRate_baseRate_nonneg" CHECK ("baseRate" >= 0);
ALTER TABLE "Template" ADD CONSTRAINT "chk_Template_wastagePercent_pct" CHECK ("wastagePercent" >= 0 AND "wastagePercent" <= 100);
ALTER TABLE "Template" ADD CONSTRAINT "chk_Template_gstPercent_pct" CHECK ("gstPercent" >= 0 AND "gstPercent" <= 100);
ALTER TABLE "Template" ADD CONSTRAINT "chk_Template_markupPercent_nonneg" CHECK ("markupPercent" >= 0);
ALTER TABLE "TemplateGroup" ADD CONSTRAINT "chk_TemplateGroup_wastagePercent_pct" CHECK ("wastagePercent" >= 0 AND "wastagePercent" <= 100);
ALTER TABLE "TemplateCategory" ADD CONSTRAINT "chk_TemplateCategory_wastagePercent_pct" CHECK ("wastagePercent" >= 0 AND "wastagePercent" <= 100);
ALTER TABLE "TemplateItem" ADD CONSTRAINT "chk_TemplateItem_wastagePercent_pct" CHECK ("wastagePercent" >= 0 AND "wastagePercent" <= 100);
ALTER TABLE "TemplateItem" ADD CONSTRAINT "chk_TemplateItem_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "TemplateLabour" ADD CONSTRAINT "chk_TemplateLabour_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "TemplateLabour" ADD CONSTRAINT "chk_TemplateLabour_rate_nonneg" CHECK ("rate" >= 0);
ALTER TABLE "TemplateExpense" ADD CONSTRAINT "chk_TemplateExpense_value_nonneg" CHECK ("value" >= 0);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_wastagePercent_pct" CHECK ("wastagePercent" >= 0 AND "wastagePercent" <= 100);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_gstPercent_pct" CHECK ("gstPercent" >= 0 AND "gstPercent" <= 100);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_markupPercent_nonneg" CHECK ("markupPercent" >= 0);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_basicCost_nonneg" CHECK ("basicCost" >= 0);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_sellingPrice_nonneg" CHECK ("sellingPrice" >= 0);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_totalCostInclGst_nonneg" CHECK ("totalCostInclGst" >= 0);
ALTER TABLE "CostingGroup" ADD CONSTRAINT "chk_CostingGroup_wastagePercent_pct" CHECK ("wastagePercent" >= 0 AND "wastagePercent" <= 100);
ALTER TABLE "CostingCategory" ADD CONSTRAINT "chk_CostingCategory_wastagePercent_pct" CHECK ("wastagePercent" >= 0 AND "wastagePercent" <= 100);
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "chk_CostingMaterial_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "chk_CostingMaterial_rate_nonneg" CHECK ("rate" >= 0);
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "chk_CostingMaterial_wastagePercent_pct" CHECK ("wastagePercent" >= 0 AND "wastagePercent" <= 100);
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "chk_CostingMaterial_wastageQuantity_nonneg" CHECK ("wastageQuantity" >= 0);
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "chk_CostingMaterial_effectiveQuantity_nonneg" CHECK ("effectiveQuantity" >= 0);
ALTER TABLE "CostingMaterial" ADD CONSTRAINT "chk_CostingMaterial_total_nonneg" CHECK ("total" >= 0);
ALTER TABLE "CostingLabour" ADD CONSTRAINT "chk_CostingLabour_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "CostingLabour" ADD CONSTRAINT "chk_CostingLabour_rate_nonneg" CHECK ("rate" >= 0);
ALTER TABLE "CostingLabour" ADD CONSTRAINT "chk_CostingLabour_total_nonneg" CHECK ("total" >= 0);
ALTER TABLE "CostingExpense" ADD CONSTRAINT "chk_CostingExpense_value_nonneg" CHECK ("value" >= 0);
ALTER TABLE "CostingExpense" ADD CONSTRAINT "chk_CostingExpense_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "CostingExpense" ADD CONSTRAINT "chk_CostingExpense_amount_nonneg" CHECK ("amount" >= 0);
ALTER TABLE "PriceList" ADD CONSTRAINT "chk_PriceList_defaultProfitValue_nonneg" CHECK ("defaultProfitValue" >= 0);
ALTER TABLE "PriceList" ADD CONSTRAINT "chk_PriceList_roundTo_nonneg" CHECK ("roundTo" >= 0);
ALTER TABLE "PriceList" ADD CONSTRAINT "chk_PriceList_cost_base" CHECK ("costBase" IN ('BASIC_COST', 'TOTAL_COST'));
ALTER TABLE "PriceList" ADD CONSTRAINT "chk_PriceList_gst_treatment" CHECK ("gstTreatment" IN ('EXCLUSIVE', 'INCLUSIVE', 'NONE'));
ALTER TABLE "PriceList" ADD CONSTRAINT "chk_PriceList_profit_method" CHECK ("defaultProfitMethod" IN ('PERCENT', 'FIXED'));
ALTER TABLE "PriceListItem" ADD CONSTRAINT "chk_PriceListItem_profit_method" CHECK ("profitMethod" IN ('PERCENT', 'FIXED'));
ALTER TABLE "PriceListItem" ADD CONSTRAINT "chk_PriceListItem_profitValue_nonneg" CHECK ("profitValue" >= 0);
ALTER TABLE "PriceListItem" ADD CONSTRAINT "chk_PriceListItem_discountPercent_pct" CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);
ALTER TABLE "PriceListItem" ADD CONSTRAINT "chk_PriceListItem_gstPercent_pct" CHECK ("gstPercent" >= 0 AND "gstPercent" <= 100);
ALTER TABLE "PriceListItem" ADD CONSTRAINT "chk_PriceListItem_discountAmount_nonneg" CHECK ("discountAmount" >= 0);
ALTER TABLE "PriceListItem" ADD CONSTRAINT "chk_PriceListItem_minPrice_nonneg" CHECK ("minPrice" >= 0);
ALTER TABLE "PriceListItem" ADD CONSTRAINT "chk_PriceListItem_maxPrice_nonneg" CHECK ("maxPrice" >= 0);
ALTER TABLE "PriceListItem" ADD CONSTRAINT "chk_PriceListItem_min_le_max" CHECK ("minPrice" <= "maxPrice");
ALTER TABLE "Quotation" ADD CONSTRAINT "chk_Quotation_discountPercent_pct" CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);
ALTER TABLE "Quotation" ADD CONSTRAINT "chk_Quotation_discountAmount_nonneg" CHECK ("discountAmount" >= 0);
ALTER TABLE "Quotation" ADD CONSTRAINT "chk_Quotation_grandTotal_nonneg" CHECK ("grandTotal" >= 0);
ALTER TABLE "QuotationItem" ADD CONSTRAINT "chk_QuotationItem_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "QuotationItem" ADD CONSTRAINT "chk_QuotationItem_unitPrice_nonneg" CHECK ("unitPrice" >= 0);
ALTER TABLE "QuotationItem" ADD CONSTRAINT "chk_QuotationItem_gstPercent_pct" CHECK ("gstPercent" >= 0 AND "gstPercent" <= 100);
ALTER TABLE "QuotationItem" ADD CONSTRAINT "chk_QuotationItem_discountPercent_pct" CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);
ALTER TABLE "QuotationItem" ADD CONSTRAINT "chk_QuotationItem_discountAmount_nonneg" CHECK ("discountAmount" >= 0);

-- At most one main image per costing / template and at most one default supplier per item.
CREATE UNIQUE INDEX "CostingImage_one_main_idx" ON "CostingImage" ("costingId") WHERE "isMain";
CREATE UNIQUE INDEX "TemplateImage_one_main_idx" ON "TemplateImage" ("templateId") WHERE "isMain";
CREATE UNIQUE INDEX "ItemSupplier_one_default_idx" ON "ItemSupplier" ("itemId") WHERE "isDefault";
