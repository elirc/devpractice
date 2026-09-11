-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('draft', 'placed', 'cancelled');

-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('received', 'sold', 'adjustment', 'returned');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "TrainingUser" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "MovementReason" NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'draft',
    "ownerId" TEXT NOT NULL,
    "placedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportLine" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "ReportLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_createdAt_id_idx" ON "Product"("createdAt", "id");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");

-- CreateIndex
CREATE INDEX "Order_createdAt_id_idx" ON "Order"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_ownerId_createdAt_id_idx" ON "Order"("ownerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "OrderLine_productId_idx" ON "OrderLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_orderId_productId_key" ON "OrderLine"("orderId", "productId");

-- CreateIndex
CREATE INDEX "ReportJob_status_runAfter_idx" ON "ReportJob"("status", "runAfter");

-- CreateIndex
CREATE UNIQUE INDEX "ReportLine_jobId_productId_key" ON "ReportLine"("jobId", "productId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TrainingUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportLine" ADD CONSTRAINT "ReportLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ReportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
