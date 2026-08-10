-- Persist developer-managed drafts and immutable published revisions for the
-- storefront notify-me runtime. The application source remains the fallback,
-- so this migration does not need to seed a row.
CREATE TABLE "NotifyMeScriptState" (
    "id" TEXT NOT NULL,
    "draftSource" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL DEFAULT 1,
    "draftChecksum" TEXT NOT NULL,
    "draftUpdatedById" TEXT,
    "draftUpdatedByName" TEXT,
    "draftUpdatedByUsername" TEXT,
    "publishedSource" TEXT,
    "publishedVersion" INTEGER NOT NULL DEFAULT 0,
    "publishedChecksum" TEXT,
    "publishedById" TEXT,
    "publishedByName" TEXT,
    "publishedByUsername" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotifyMeScriptState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotifyMeScriptRevision" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedByName" TEXT,
    "publishedByUsername" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotifyMeScriptRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotifyMeScriptRevision_version_key"
    ON "NotifyMeScriptRevision"("version");
CREATE INDEX "NotifyMeScriptRevision_publishedAt_idx"
    ON "NotifyMeScriptRevision"("publishedAt");
