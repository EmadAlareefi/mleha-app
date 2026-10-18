import { prisma } from '@/lib/prisma';
import { generateApiKey, getApiKeyPepper } from './credentials';
import { normalizeScopes, type HermesScope } from './scopes';

/**
 * Credential lifecycle for the Hermes API, used by scripts/hermes-credentials.ts.
 * There is deliberately no HTTP endpoint for this: keys are issued by an
 * operator with database access, and the plaintext key is returned once.
 */

const MAX_EXPIRY_DAYS = 365;

export interface CreateCredentialInput {
  name: string;
  merchantId: string;
  scopes: readonly string[];
  createdBy: string;
  expiresInDays?: number | null;
  rotatedFromId?: string | null;
}

export interface IssuedCredential {
  id: string;
  apiKey: string;
  keyId: string;
  scopes: HermesScope[];
  expiresAt: Date | null;
}

function validate(input: CreateCredentialInput): HermesScope[] {
  if (!input.name.trim()) throw new Error('name is required');
  if (!/^\d{1,20}$/.test(input.merchantId)) throw new Error('merchantId must be a Salla merchant id');
  if (!input.createdBy.trim()) throw new Error('createdBy is required');
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0 || scopes.length !== new Set(input.scopes).size) {
    throw new Error('scopes must be a non-empty list of known hermes:* scopes');
  }
  if (
    input.expiresInDays != null &&
    (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > MAX_EXPIRY_DAYS)
  ) {
    throw new Error(`expiresInDays must be an integer between 1 and ${MAX_EXPIRY_DAYS}`);
  }
  return scopes;
}

export async function createCredential(input: CreateCredentialInput, now: Date = new Date()): Promise<IssuedCredential> {
  const scopes = validate(input);
  const { apiKey, keyId, secretHash } = generateApiKey(getApiKeyPepper());
  const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86_400_000) : null;
  const row = await prisma.hermesApiCredential.create({
    data: {
      keyId,
      secretHash,
      name: input.name.trim(),
      merchantId: input.merchantId,
      scopes,
      createdBy: input.createdBy.trim(),
      expiresAt,
      rotatedFromId: input.rotatedFromId ?? null,
    },
    select: { id: true },
  });
  return { id: row.id, apiKey, keyId, scopes, expiresAt };
}

export async function revokeCredential(id: string, revokedBy: string, reason: string | null, now: Date = new Date()) {
  if (!revokedBy.trim()) throw new Error('revokedBy is required');
  const result = await prisma.hermesApiCredential.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now, revokedBy: revokedBy.trim(), revokeReason: reason?.trim() || null },
  });
  if (result.count === 0) throw new Error('credential not found or already revoked');
}

/**
 * Issues a replacement with the same name, tenant and scopes. The old key
 * keeps working for `graceHours` (so Hermes can be reconfigured without
 * downtime) and is revoked immediately when `graceHours` is 0.
 */
export async function rotateCredential(
  id: string,
  rotatedBy: string,
  graceHours: number,
  now: Date = new Date()
): Promise<IssuedCredential> {
  if (!Number.isInteger(graceHours) || graceHours < 0 || graceHours > 168) {
    throw new Error('graceHours must be an integer between 0 and 168');
  }
  const current = await prisma.hermesApiCredential.findUnique({
    where: { id },
    select: { id: true, name: true, merchantId: true, scopes: true, revokedAt: true, expiresAt: true },
  });
  if (!current || current.revokedAt) throw new Error('credential not found or revoked');

  const remainingDays = current.expiresAt
    ? Math.max(1, Math.ceil((current.expiresAt.getTime() - now.getTime()) / 86_400_000))
    : null;
  const issued = await createCredential(
    {
      name: current.name,
      merchantId: current.merchantId,
      scopes: current.scopes,
      createdBy: rotatedBy,
      expiresInDays: remainingDays ? Math.min(remainingDays, MAX_EXPIRY_DAYS) : null,
      rotatedFromId: current.id,
    },
    now
  );

  if (graceHours === 0) {
    await revokeCredential(current.id, rotatedBy, `rotated to ${issued.id}`, now);
  } else {
    const graceEnd = new Date(now.getTime() + graceHours * 3_600_000);
    await prisma.hermesApiCredential.update({
      where: { id: current.id },
      data: { expiresAt: current.expiresAt && current.expiresAt < graceEnd ? current.expiresAt : graceEnd },
      select: { id: true },
    });
  }
  return issued;
}

export async function listCredentials(merchantId?: string) {
  return prisma.hermesApiCredential.findMany({
    where: merchantId ? { merchantId } : {},
    // secretHash is never selected for display.
    select: {
      id: true,
      keyId: true,
      name: true,
      merchantId: true,
      scopes: true,
      createdBy: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      revokedBy: true,
      lastUsedAt: true,
      rotatedFromId: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
