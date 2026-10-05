import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ExpenseError } from './domain';

type KeySource = 'expense' | 'auth';
function key(source: KeySource): Buffer {
  if (source === 'expense') {
    const raw = process.env.EXPENSE_CREDENTIAL_KEY || '';
    if (!/^[a-fA-F0-9]{64}$/.test(raw)) throw new ExpenseError('مفتاح تشفير بيانات الإعلانات غير صالح؛ تواصل مع مسؤول النظام', 503);
    return Buffer.from(raw, 'hex');
  }
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new ExpenseError('يلزم إعداد مفتاح تشفير على الخادم قبل حفظ بيانات الإعلانات', 503);
  // Domain separation keeps this key distinct from session signing material.
  return createHash('sha256').update('mleha:expense-credentials:v1\0').update(secret).digest();
}
export function credentialEncryptionReady(): boolean {
  try { key(process.env.EXPENSE_CREDENTIAL_KEY ? 'expense' : 'auth'); return true; }
  catch { return false; }
}
export function encryptSecret(value: string): string {
  const source: KeySource = process.env.EXPENSE_CREDENTIAL_KEY ? 'expense' : 'auth';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(source), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', source, ...[iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64'))].join('.');
}
export function decryptSecret(value: string): string {
  const parts = value.split('.');
  // Legacy connection tokens used an unversioned envelope and the dedicated key.
  const source = parts.length === 3 ? 'expense' : parts[1];
  if ((parts.length !== 3 && (parts.length !== 5 || parts[0] !== 'v1')) || (source !== 'expense' && source !== 'auth')) throw new ExpenseError('تعذر قراءة بيانات الاعتماد؛ أعد حفظها', 503);
  const [iv, tag, encrypted] = parts.slice(-3).map(v => Buffer.from(v, 'base64'));
  try {
    const cipher = createDecipheriv('aes-256-gcm', key(source), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
  } catch { throw new ExpenseError('تعذر فك تشفير بيانات الاعتماد؛ تحقق من مفتاح الخادم أو أعد حفظها', 503); }
}
