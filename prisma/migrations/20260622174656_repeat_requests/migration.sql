-- CreateTable
CREATE TABLE "RepeatRequest" (
    "id" TEXT NOT NULL,
    "designModelId" TEXT NOT NULL,
    "tailorId" TEXT,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "modelCount" INTEGER NOT NULL DEFAULT 0,
    "repeatDate" TIMESTAMP(3),
    "arrivalDate" TIMESTAMP(3),
    "inStock" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepeatRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepeatRequestSize" (
    "id" TEXT NOT NULL,
    "repeatRequestId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RepeatRequestSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepeatRequestNote" (
    "id" TEXT NOT NULL,
    "repeatRequestId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepeatRequestNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepeatRequestLog" (
    "id" TEXT NOT NULL,
    "repeatRequestId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepeatRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepeatRequest_designModelId_key" ON "RepeatRequest"("designModelId");

-- CreateIndex
CREATE INDEX "RepeatRequest_stage_idx" ON "RepeatRequest"("stage");

-- CreateIndex
CREATE INDEX "RepeatRequest_tailorId_idx" ON "RepeatRequest"("tailorId");

-- CreateIndex
CREATE INDEX "RepeatRequest_updatedAt_idx" ON "RepeatRequest"("updatedAt");

-- CreateIndex
CREATE INDEX "RepeatRequestSize_repeatRequestId_idx" ON "RepeatRequestSize"("repeatRequestId");

-- CreateIndex
CREATE INDEX "RepeatRequestNote_repeatRequestId_idx" ON "RepeatRequestNote"("repeatRequestId");

-- CreateIndex
CREATE INDEX "RepeatRequestLog_repeatRequestId_createdAt_idx" ON "RepeatRequestLog"("repeatRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "RepeatRequest" ADD CONSTRAINT "RepeatRequest_designModelId_fkey" FOREIGN KEY ("designModelId") REFERENCES "DesignModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepeatRequest" ADD CONSTRAINT "RepeatRequest_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "Tailor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepeatRequestSize" ADD CONSTRAINT "RepeatRequestSize_repeatRequestId_fkey" FOREIGN KEY ("repeatRequestId") REFERENCES "RepeatRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepeatRequestNote" ADD CONSTRAINT "RepeatRequestNote_repeatRequestId_fkey" FOREIGN KEY ("repeatRequestId") REFERENCES "RepeatRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepeatRequestLog" ADD CONSTRAINT "RepeatRequestLog_repeatRequestId_fkey" FOREIGN KEY ("repeatRequestId") REFERENCES "RepeatRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

