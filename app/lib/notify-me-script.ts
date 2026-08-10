import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { Prisma } from '@prisma/client';
import { NOTIFY_ME_WIDGET_SOURCE } from '@/app/embed/notify-me-widget';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';

export const NOTIFY_ME_SCRIPT_SERVICE_KEY = 'notify-script-editor' as const;
export const NOTIFY_ME_SCRIPT_STATE_ID = 'notify-me-runtime';
export const NOTIFY_ME_SCRIPT_MAX_BYTES = 256 * 1024;

export type NotifyMeScriptAudit = {
  id: string | null;
  name: string | null;
  username: string | null;
};

export type NotifyMeScriptValidation = {
  valid: boolean;
  error: string | null;
};

export class NotifyMeScriptConflictError extends Error {
  constructor() {
    super('تم تعديل المسودة في جلسة أخرى. أعد تحميل أحدث نسخة قبل المتابعة.');
    this.name = 'NotifyMeScriptConflictError';
  }
}

export class NotifyMeScriptNotFoundError extends Error {
  constructor(message = 'نسخة السكربت غير موجودة') {
    super(message);
    this.name = 'NotifyMeScriptNotFoundError';
  }
}

export class NotifyMeScriptInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotifyMeScriptInputError';
  }
}

export function notifyMeScriptAudit(user: unknown): NotifyMeScriptAudit {
  const value = user && typeof user === 'object' ? (user as Record<string, unknown>) : {};
  return {
    id: typeof value.id === 'string' ? value.id : null,
    name: typeof value.name === 'string' ? value.name : null,
    username:
      typeof value.username === 'string'
        ? value.username
        : typeof value.email === 'string'
          ? value.email
          : null,
  };
}

export function notifyMeScriptChecksum(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function notifyMeScriptByteLength(source: string): number {
  return Buffer.byteLength(source, 'utf8');
}

export function validateNotifyMeScriptSource(source: string): NotifyMeScriptValidation {
  if (!source.trim()) {
    return { valid: false, error: 'السكربت فارغ' };
  }
  if (notifyMeScriptByteLength(source) > NOTIFY_ME_SCRIPT_MAX_BYTES) {
    return {
      valid: false,
      error: `حجم السكربت يتجاوز الحد المسموح (${NOTIFY_ME_SCRIPT_MAX_BYTES / 1024} كيلوبايت)`,
    };
  }

  try {
    // Compiles as a classic browser script without executing any developer code.
    new Script(source, { filename: 'notify-me-runtime.js' });
    return { valid: true, error: null };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'صياغة JavaScript غير صالحة',
    };
  }
}

function parseDraftSource(value: unknown): string {
  if (typeof value !== 'string') {
    throw new NotifyMeScriptInputError('نص السكربت مطلوب');
  }
  if (notifyMeScriptByteLength(value) > NOTIFY_ME_SCRIPT_MAX_BYTES) {
    throw new NotifyMeScriptInputError(
      `حجم السكربت يتجاوز الحد المسموح (${NOTIFY_ME_SCRIPT_MAX_BYTES / 1024} كيلوبايت)`
    );
  }
  return value;
}

function parseDraftVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new NotifyMeScriptInputError('رقم إصدار المسودة غير صالح');
  }
  return value;
}

async function ensureNotifyMeScriptState() {
  const existing = await prisma.notifyMeScriptState.findUnique({
    where: { id: NOTIFY_ME_SCRIPT_STATE_ID },
  });
  if (existing) return existing;

  try {
    return await prisma.notifyMeScriptState.create({
      data: {
        id: NOTIFY_ME_SCRIPT_STATE_ID,
        draftSource: NOTIFY_ME_WIDGET_SOURCE,
        draftChecksum: notifyMeScriptChecksum(NOTIFY_ME_WIDGET_SOURCE),
      },
    });
  } catch (error) {
    // Two first-time editor requests may race to initialize the singleton.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.notifyMeScriptState.findUniqueOrThrow({
        where: { id: NOTIFY_ME_SCRIPT_STATE_ID },
      });
    }
    throw error;
  }
}

function editorStateResponse(state: Awaited<ReturnType<typeof ensureNotifyMeScriptState>>) {
  return {
    id: state.id,
    draftSource: state.draftSource,
    draftVersion: state.draftVersion,
    draftChecksum: state.draftChecksum,
    draftValidation: validateNotifyMeScriptSource(state.draftSource),
    draftUpdatedBy: {
      id: state.draftUpdatedById,
      name: state.draftUpdatedByName,
      username: state.draftUpdatedByUsername,
    },
    draftUpdatedAt: state.updatedAt,
    publishedVersion: state.publishedVersion,
    publishedChecksum: state.publishedChecksum,
    publishedBy: {
      id: state.publishedById,
      name: state.publishedByName,
      username: state.publishedByUsername,
    },
    publishedAt: state.publishedAt,
    isUsingRepositoryDefault: !state.publishedSource,
    repositoryDefaultChecksum: notifyMeScriptChecksum(NOTIFY_ME_WIDGET_SOURCE),
    maxBytes: NOTIFY_ME_SCRIPT_MAX_BYTES,
  };
}

export async function getNotifyMeScriptEditorState() {
  return editorStateResponse(await ensureNotifyMeScriptState());
}

export async function saveNotifyMeScriptDraft(input: {
  source: unknown;
  baseDraftVersion: unknown;
  user: unknown;
}) {
  const source = parseDraftSource(input.source);
  const baseDraftVersion = parseDraftVersion(input.baseDraftVersion);
  const audit = notifyMeScriptAudit(input.user);
  await ensureNotifyMeScriptState();

  const updated = await prisma.notifyMeScriptState.updateMany({
    where: { id: NOTIFY_ME_SCRIPT_STATE_ID, draftVersion: baseDraftVersion },
    data: {
      draftSource: source,
      draftChecksum: notifyMeScriptChecksum(source),
      draftVersion: { increment: 1 },
      draftUpdatedById: audit.id,
      draftUpdatedByName: audit.name,
      draftUpdatedByUsername: audit.username,
    },
  });
  if (updated.count !== 1) throw new NotifyMeScriptConflictError();

  const state = await prisma.notifyMeScriptState.findUniqueOrThrow({
    where: { id: NOTIFY_ME_SCRIPT_STATE_ID },
  });
  return editorStateResponse(state);
}

export async function publishNotifyMeScriptDraft(input: {
  baseDraftVersion: unknown;
  user: unknown;
}) {
  const baseDraftVersion = parseDraftVersion(input.baseDraftVersion);
  const audit = notifyMeScriptAudit(input.user);
  await ensureNotifyMeScriptState();

  try {
    return await prisma.$transaction(async (tx) => {
      const state = await tx.notifyMeScriptState.findUnique({
        where: { id: NOTIFY_ME_SCRIPT_STATE_ID },
      });
      if (!state || state.draftVersion !== baseDraftVersion) {
        throw new NotifyMeScriptConflictError();
      }

      const validation = validateNotifyMeScriptSource(state.draftSource);
      if (!validation.valid) {
        throw new NotifyMeScriptInputError(validation.error || 'السكربت غير صالح للنشر');
      }

      const publishedVersion = state.publishedVersion + 1;
      const checksum = notifyMeScriptChecksum(state.draftSource);
      const revision = await tx.notifyMeScriptRevision.create({
        data: {
          version: publishedVersion,
          source: state.draftSource,
          checksum,
          publishedById: audit.id,
          publishedByName: audit.name,
          publishedByUsername: audit.username,
        },
      });
      const updated = await tx.notifyMeScriptState.updateMany({
        where: {
          id: NOTIFY_ME_SCRIPT_STATE_ID,
          draftVersion: baseDraftVersion,
          publishedVersion: state.publishedVersion,
        },
        data: {
          publishedSource: state.draftSource,
          publishedVersion,
          publishedChecksum: checksum,
          publishedById: audit.id,
          publishedByName: audit.name,
          publishedByUsername: audit.username,
          publishedAt: revision.publishedAt,
        },
      });
      if (updated.count !== 1) throw new NotifyMeScriptConflictError();

      return {
        revision: {
          id: revision.id,
          version: revision.version,
          checksum: revision.checksum,
          publishedAt: revision.publishedAt,
          publishedBy: {
            id: revision.publishedById,
            name: revision.publishedByName,
            username: revision.publishedByUsername,
          },
        },
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new NotifyMeScriptConflictError();
    }
    throw error;
  }
}

export async function listNotifyMeScriptRevisions(input: {
  cursor?: string | null;
  take?: number;
}) {
  const take = Math.max(1, Math.min(input.take || 20, 50));
  const revisions = await prisma.notifyMeScriptRevision.findMany({
    orderBy: { version: 'desc' },
    take: take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      version: true,
      checksum: true,
      publishedById: true,
      publishedByName: true,
      publishedByUsername: true,
      publishedAt: true,
    },
  });
  const hasMore = revisions.length > take;
  const page = hasMore ? revisions.slice(0, take) : revisions;
  return {
    revisions: page.map((revision) => ({
      id: revision.id,
      version: revision.version,
      checksum: revision.checksum,
      publishedAt: revision.publishedAt,
      publishedBy: {
        id: revision.publishedById,
        name: revision.publishedByName,
        username: revision.publishedByUsername,
      },
    })),
    nextCursor: hasMore ? page.at(-1)?.id || null : null,
  };
}

export async function getNotifyMeScriptRevision(id: string) {
  const revision = await prisma.notifyMeScriptRevision.findUnique({ where: { id } });
  if (!revision) throw new NotifyMeScriptNotFoundError();
  return {
    id: revision.id,
    version: revision.version,
    source: revision.source,
    checksum: revision.checksum,
    publishedAt: revision.publishedAt,
    publishedBy: {
      id: revision.publishedById,
      name: revision.publishedByName,
      username: revision.publishedByUsername,
    },
  };
}

export async function restoreNotifyMeScriptRevision(input: {
  id: string;
  baseDraftVersion: unknown;
  user: unknown;
}) {
  const revision = await prisma.notifyMeScriptRevision.findUnique({ where: { id: input.id } });
  if (!revision) throw new NotifyMeScriptNotFoundError();
  return saveNotifyMeScriptDraft({
    source: revision.source,
    baseDraftVersion: input.baseDraftVersion,
    user: input.user,
  });
}

export async function resetNotifyMeScriptDraft(input: {
  baseDraftVersion: unknown;
  user: unknown;
}) {
  return saveNotifyMeScriptDraft({
    source: NOTIFY_ME_WIDGET_SOURCE,
    baseDraftVersion: input.baseDraftVersion,
    user: input.user,
  });
}

export async function resolvePublishedNotifyMeScript() {
  const fallback = {
    source: NOTIFY_ME_WIDGET_SOURCE,
    checksum: notifyMeScriptChecksum(NOTIFY_ME_WIDGET_SOURCE),
    version: 0,
    isRepositoryDefault: true,
  };

  try {
    const state = await prisma.notifyMeScriptState.findUnique({
      where: { id: NOTIFY_ME_SCRIPT_STATE_ID },
      select: {
        publishedSource: true,
        publishedChecksum: true,
        publishedVersion: true,
      },
    });
    if (!state?.publishedSource) return fallback;
    return {
      source: state.publishedSource,
      checksum: state.publishedChecksum || notifyMeScriptChecksum(state.publishedSource),
      version: state.publishedVersion,
      isRepositoryDefault: false,
    };
  } catch (error) {
    log.error('Failed to load published notify-me script; serving repository default', { error });
    return fallback;
  }
}
