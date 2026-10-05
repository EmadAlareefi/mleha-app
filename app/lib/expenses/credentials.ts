import { createHash } from 'node:crypto';
import { ExpenseError, type Provider } from './domain';
import { credentialEncryptionReady, decryptSecret, encryptSecret } from './crypto';
import { readProviderAppConfig } from './provider-settings';
export type Credentials = { accessToken: string; refreshToken?: string; expiresAt?: number };
export function encryptCredentials(value: Credentials) { return encryptSecret(JSON.stringify(value)); }
export function decryptCredentials(value: string): Credentials { return JSON.parse(decryptSecret(value)); }
export function stateHash(state: string) { return createHash('sha256').update(state).digest('hex'); }
export async function providerConfig(provider: Provider) {
  const prefix = `EXPENSE_${provider.toUpperCase()}`;
  const { clientId, clientSecret } = await readProviderAppConfig(provider);
  const origin = process.env.NEXTAUTH_URL;
  if (!clientId || !clientSecret || !origin) throw new ExpenseError(`أضف بيانات ${prefix} من صفحة الإعدادات، وتحقق من NEXTAUTH_URL على الخادم`, 503);
  if (!credentialEncryptionReady()) throw new ExpenseError('تشفير بيانات الاعتماد غير مهيأ على الخادم', 503);
  return { clientId, clientSecret, redirectUri: `${origin.replace(/\/$/, '')}/api/expenses/ad-connections/callback/${provider}` };
}
export async function authorizationUrl(provider: Provider, state: string) {
  const config = await providerConfig(provider);
  const url = new URL(provider === 'meta' ? 'https://www.facebook.com/v25.0/dialog/oauth' : provider === 'tiktok' ? 'https://business-api.tiktok.com/portal/auth' : 'https://accounts.snapchat.com/login/oauth2/authorize');
  url.searchParams.set(provider === 'tiktok' ? 'app_id' : 'client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  if (provider !== 'tiktok') {
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', provider === 'meta' ? 'business_management,ads_read' : 'snapchat-marketing-api');
  }
  return url.toString();
}
export async function exchangeCredentials(provider: Provider, code: string, refresh = false): Promise<Credentials> {
  const { clientId, clientSecret, redirectUri } = await providerConfig(provider);
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: refresh ? 'refresh_token' : 'authorization_code', [refresh ? 'refresh_token' : 'code']: code });
  const endpoint = provider === 'meta' ? 'https://graph.facebook.com/v25.0/oauth/access_token' : provider === 'tiktok' ? 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/' : 'https://accounts.snapchat.com/login/oauth2/access_token';
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': provider === 'tiktok' ? 'application/json' : 'application/x-www-form-urlencoded' }, body: provider === 'tiktok' ? JSON.stringify({ app_id: clientId, secret: clientSecret, auth_code: code }) : body, signal: AbortSignal.timeout(20000), cache: 'no-store', redirect: 'error' });
  const data = await response.json();
  const token = provider === 'tiktok' ? data.data : data;
  if (!response.ok || (provider === 'tiktok' && data.code !== 0) || typeof token?.access_token !== 'string') throw new ExpenseError('فشل التفويض؛ أعد ربط الحساب وتحقق من صلاحيات الفواتير', 401);
  return { accessToken: token.access_token, refreshToken: token.refresh_token || (refresh ? code : undefined), expiresAt: Number(token.expires_in) > 0 ? Date.now() + Number(token.expires_in) * 1000 : undefined };
}
