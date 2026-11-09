-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);


-- The settings table holds exactly one row.
ALTER TABLE "AppSettings" ADD CONSTRAINT "chk_AppSettings_single_row" CHECK ("id" = 1);
