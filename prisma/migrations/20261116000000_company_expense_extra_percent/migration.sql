-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "isCompanyExpense" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CostingExpense" ADD COLUMN "isCompany" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Costing" ADD COLUMN "extraPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
ADD COLUMN "extraAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "companyExpenseCost" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- The extra % is a share of the cost: 0 to 100. Its amounts are never negative.
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_extraPercent_pct" CHECK ("extraPercent" >= 0 AND "extraPercent" <= 100);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_extraAmount_nonneg" CHECK ("extraAmount" >= 0);
ALTER TABLE "Costing" ADD CONSTRAINT "chk_Costing_companyExpenseCost_nonneg" CHECK ("companyExpenseCost" >= 0);

-- A change to a company expense reaches every live costing (it is added to all of them).
ALTER TYPE "RecalcKind" ADD VALUE 'COMPANY_EXPENSE';
