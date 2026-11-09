-- CreateTable
CREATE TABLE "FileAttachment" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingImage" (
    "id" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "description" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostingImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateImage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "description" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileAttachment_storageKey_key" ON "FileAttachment"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "FileAttachment_thumbKey_key" ON "FileAttachment"("thumbKey");

-- CreateIndex
CREATE INDEX "FileAttachment_sha256_idx" ON "FileAttachment"("sha256");

-- CreateIndex
CREATE INDEX "CostingImage_costingId_idx" ON "CostingImage"("costingId");

-- CreateIndex
CREATE UNIQUE INDEX "CostingImage_costingId_fileId_key" ON "CostingImage"("costingId", "fileId");

-- CreateIndex
CREATE INDEX "TemplateImage_templateId_idx" ON "TemplateImage"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateImage_templateId_fileId_key" ON "TemplateImage"("templateId", "fileId");

-- AddForeignKey
ALTER TABLE "CostingImage" ADD CONSTRAINT "CostingImage_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "Costing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingImage" ADD CONSTRAINT "CostingImage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateImage" ADD CONSTRAINT "TemplateImage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateImage" ADD CONSTRAINT "TemplateImage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

