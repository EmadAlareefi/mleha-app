-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "ExpenseSubscription" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL DEFAULT 'default',
    "title" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "category" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "nextDate" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseOccurrence" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdInvoiceConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "billingOwnerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL DEFAULT 'default',
    "importFrom" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'setup',
    "encryptedCredentials" TEXT,
    "oauthStateHash" TEXT,
    "oauthExpiresAt" TIMESTAMP(3),
    "cursor" TEXT,
    "syncStartedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockToken" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdInvoiceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdImportedInvoice" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "billingOwnerId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "billingPeriod" TEXT,
    "taxDetails" JSONB,
    "fingerprint" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'imported',
    "reviewReason" TEXT,
    "latestMetadata" JSONB,
    "expenseId" TEXT,
    "document" BYTEA,
    "documentError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdImportedInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseSyncRun" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'running',
    "imported" INTEGER NOT NULL DEFAULT 0,
    "reviewed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExpenseSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseSubscription_state_nextDate_idx" ON "ExpenseSubscription"("state", "nextDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseOccurrence_expenseId_key" ON "ExpenseOccurrence"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseOccurrence_subscriptionId_dueDate_key" ON "ExpenseOccurrence"("subscriptionId", "dueDate");

-- CreateIndex
CREATE INDEX "AdInvoiceConnection_state_nextAttemptAt_idx" ON "AdInvoiceConnection"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdInvoiceConnection_provider_billingOwnerId_key" ON "AdInvoiceConnection"("provider", "billingOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "AdImportedInvoice_expenseId_key" ON "AdImportedInvoice"("expenseId");

-- CreateIndex
CREATE INDEX "AdImportedInvoice_connectionId_issueDate_idx" ON "AdImportedInvoice"("connectionId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "AdImportedInvoice_provider_billingOwnerId_providerId_key" ON "AdImportedInvoice"("provider", "billingOwnerId", "providerId");

-- CreateIndex
CREATE INDEX "ExpenseSyncRun_connectionId_startedAt_idx" ON "ExpenseSyncRun"("connectionId", "startedAt");

-- AddForeignKey
ALTER TABLE "ExpenseOccurrence" ADD CONSTRAINT "ExpenseOccurrence_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ExpenseSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseOccurrence" ADD CONSTRAINT "ExpenseOccurrence_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImportedInvoice" ADD CONSTRAINT "AdImportedInvoice_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AdInvoiceConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImportedInvoice" ADD CONSTRAINT "AdImportedInvoice_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseSyncRun" ADD CONSTRAINT "ExpenseSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AdInvoiceConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
