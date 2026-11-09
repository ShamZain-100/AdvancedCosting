-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "marginPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCustomerGroup" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "UserCustomerGroup_pkey" PRIMARY KEY ("userId","groupId")
);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_code_key" ON "CustomerGroup"("code");

-- CreateIndex
CREATE INDEX "CustomerGroup_name_idx" ON "CustomerGroup"("name");

-- CreateIndex
CREATE INDEX "UserCustomerGroup_groupId_idx" ON "UserCustomerGroup"("groupId");

-- CreateIndex
CREATE INDEX "Customer_groupId_idx" ON "Customer"("groupId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCustomerGroup" ADD CONSTRAINT "UserCustomerGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCustomerGroup" ADD CONSTRAINT "UserCustomerGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A margin is a markup on cost: never negative (there is no upper limit, like the costing markup).
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "chk_CustomerGroup_marginPercent" CHECK ("marginPercent" >= 0);

-- Search by name, like the other masters.
CREATE INDEX "CustomerGroup_name_trgm_idx" ON "CustomerGroup" USING GIN ("name" gin_trgm_ops);
