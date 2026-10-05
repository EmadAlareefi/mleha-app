import { prisma } from '@/lib/prisma';
import { credentialEncryptionReady, decryptSecret, encryptSecret } from './crypto';
import { ExpenseError, providers, text, type Provider } from './domain';
import { EXPENSE_CREDENTIAL_SETTINGS_PREFIX } from './settings-keys';

type StoredConfig = { clientId: string; encryptedClientSecret: string; updatedBy: string };
function settingKey(provider: Provider) { return `${EXPENSE_CREDENTIAL_SETTINGS_PREFIX}${provider}`; }
function parseConfig(value: string): StoredConfig {
  const parsed = JSON.parse(value) as StoredConfig;
  if (typeof parsed.clientId !== 'string' || typeof parsed.encryptedClientSecret !== 'string') throw new ExpenseError('بيانات الربط المحفوظة غير صالحة؛ أعد حفظ بيانات التطبيق', 503);
  return parsed;
}
function environmentConfig(provider: Provider) {
  const prefix = `EXPENSE_${provider.toUpperCase()}`;
  return { clientId: process.env[`${prefix}_CLIENT_ID`] || '', clientSecret: process.env[`${prefix}_CLIENT_SECRET`] || '' };
}
export async function readProviderAppConfig(provider: Provider, db = prisma) {
  const row = await db.settings.findUnique({ where: { key: settingKey(provider) } });
  if (!row) return environmentConfig(provider);
  const stored = parseConfig(row.value);
  // Database configuration overrides the environment as a pair, never mix apps.
  return { clientId: stored.clientId, clientSecret: decryptSecret(stored.encryptedClientSecret) };
}
export async function providerSettingsSummary(db = prisma) {
  const rows = await db.settings.findMany({ where: { key: { startsWith: EXPENSE_CREDENTIAL_SETTINGS_PREFIX } } });
  const configurations = providers.map(provider => {
    const row = rows.find(r => r.key === settingKey(provider));
    const saved = row ? parseConfig(row.value) : null;
    const env = environmentConfig(provider);
    return {
      provider,
      clientId: saved ? saved.clientId : env.clientId,
      hasClientSecret: saved ? !!saved.encryptedClientSecret : !!env.clientSecret,
      source: saved ? 'settings' : env.clientId || env.clientSecret ? 'environment' : 'none',
      updatedAt: row?.updatedAt.toISOString() || null,
      callbackUrl: process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL.replace(/\/$/, '')}/api/expenses/ad-connections/callback/${provider}` : null,
    };
  });
  return { configurations, encryptionReady: credentialEncryptionReady() };
}
export async function saveProviderAppConfig(provider: Provider, body: Record<string, unknown>, actor: string, db = prisma) {
  const clientId = text(body.clientId, 'معرف التطبيق', 200);
  if (!/^[a-zA-Z0-9._-]+$/.test(clientId)) throw new ExpenseError('معرف التطبيق غير صالح');
  if (body.clientSecret !== undefined && typeof body.clientSecret !== 'string') throw new ExpenseError('سر التطبيق غير صالح');
  const secret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
  if (secret.length > 8000) throw new ExpenseError('سر التطبيق طويل جداً');
  // An empty input preserves the stored secret; it is never sent back to the browser.
  const existing = secret ? null : await db.settings.findUnique({ where: { key: settingKey(provider) } });
  const stored = existing ? parseConfig(existing.value) : null;
  const env = environmentConfig(provider);
  if (!secret && clientId !== (stored?.clientId || env.clientId)) throw new ExpenseError('أدخل سر التطبيق عند تغيير معرف التطبيق');
  const effectiveSecret = secret || (stored ? null : env.clientSecret);
  if (!stored && !effectiveSecret) throw new ExpenseError('سر التطبيق مطلوب');
  const value = JSON.stringify({ clientId, encryptedClientSecret: effectiveSecret ? encryptSecret(effectiveSecret) : stored!.encryptedClientSecret, updatedBy: actor } satisfies StoredConfig);
  await db.settings.upsert({ where: { key: settingKey(provider) }, create: { key: settingKey(provider), value, description: 'Encrypted advertising app credentials' }, update: { value } });
}
