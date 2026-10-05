import { currency, dateOnly, ExpenseError, money, text, today, validatePdf, type Provider } from './domain';
import type { Credentials } from './credentials';

export type Invoice = {
  id: string; number: string; issueDate: string; amount: string; currency: string;
  billingPeriod?: string; taxDetails?: Record<string, string>; reviewReason?: string;
  pdfUrl?: string; pdfBase64?: string;
};
type Row = Record<string, unknown>;
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExpenseError('استجابة الفواتير غير متوافقة؛ يلزم مراجعة الربط', 502);
  return value as Row;
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new ExpenseError('استجابة الفواتير غير متوافقة؛ يلزم مراجعة الربط', 502);
  return value.map(object);
}
function issueDate(value: unknown) {
  if (typeof value !== 'string') throw new ExpenseError('تاريخ إصدار الفاتورة غير متاح؛ يلزم المراجعة', 502);
  return dateOnly(value.slice(0, 10));
}
export function normalizeInvoice(provider: Provider, row: Row): Invoice {
  let result: Invoice;
  if (provider === 'snapchat') {
    if (!Number.isSafeInteger(Number(row.amount_cent))) throw new ExpenseError('قيمة فاتورة Snapchat غير صالحة', 502);
    result = { id: text(row.invoice_id, 'invoice_id'), number: text(row.document_number, 'document_number'), issueDate: issueDate(row.created_at), amount: money((Number(row.amount_cent) / 100).toFixed(2), true), currency: currency(row.currency), billingPeriod: String(row.billing_period || ''), pdfBase64: typeof row.invoice_content === 'string' ? row.invoice_content : undefined };
  } else if (provider === 'meta') {
    const billed = object(row.billed_amount_details);
    result = { id: text(row.id, 'id'), number: text(row.invoice_id, 'invoice_id'), issueDate: issueDate(row.invoice_date), amount: money(billed.total_amount, true), currency: currency(billed.currency), billingPeriod: String(row.billing_period || ''), taxDetails: billed.tax_amount == null ? undefined : { tax: money(billed.tax_amount, true) }, pdfUrl: typeof row.cdn_download_uri === 'string' ? row.cdn_download_uri : typeof row.download_uri === 'string' ? row.download_uri : undefined };
  } else {
    // Fail closed if the account's invoice response does not expose a total and issue date.
    // Never use advertiser balance, transaction amount, or campaign spend as a substitute.
    result = { id: text(String(row.invoice_id ?? ''), 'invoice_id'), number: text(String(row.invoice_number ?? row.invoice_id ?? ''), 'invoice_number'), issueDate: issueDate(row.invoice_date ?? row.create_time), amount: money(row.total_amount ?? row.invoice_amount, true), currency: currency(row.currency), billingPeriod: typeof row.billing_period === 'string' ? row.billing_period : undefined, taxDetails: row.tax_amount == null ? undefined : { tax: money(row.tax_amount, true) }, pdfUrl: typeof row.download_url === 'string' ? row.download_url : undefined };
  }
  const kind = String(row.invoice_type ?? row.type ?? '').toLowerCase();
  const status = String(row.invoice_status ?? row.status ?? '').toLowerCase();
  if (provider === 'meta' && !['invoice', 'credit memo', 'credit', 'credit_note'].includes(kind)) result.reviewReason = 'نوع مستند Meta غير معروف؛ يلزم المراجعة';
  if (provider === 'tiktok' && !['recon', 'credit'].includes(kind)) result.reviewReason = 'نوع مستند TikTok غير معروف؛ يلزم المراجعة';
  if (Number(result.amount) <= 0 || /credit|cancel|void|refund/.test(`${kind} ${status}`)) result.reviewReason = 'إشعار دائن أو فاتورة ملغاة؛ يلزم مراجعة يدوية';
  if (/draft|pending|processing/.test(status)) result.reviewReason = 'فاتورة غير نهائية؛ يلزم مراجعة يدوية';
  return result;
}
async function api(url: URL, provider: Provider, credentials: Credentials): Promise<Row> {
  const response = await fetch(url, { headers: provider === 'tiktok' ? { 'Access-Token': credentials.accessToken } : { Authorization: `Bearer ${credentials.accessToken}` }, cache: 'no-store', signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (response.status === 429) throw new ExpenseError('تم بلوغ حد طلبات المنصة؛ ستتم إعادة المحاولة تلقائياً', 429);
  if (response.status === 401 || response.status === 403) throw new ExpenseError('تعذر الوصول إلى الفواتير؛ تحقق من التفويض وصلاحيات الفوترة', 401);
  if (!response.ok) throw new ExpenseError(`فشل مزود الفواتير (HTTP ${response.status})`, 502);
  const data = object(await response.json());
  if (data.error || (provider === 'tiktok' && data.code !== 0) || (provider === 'snapchat' && data.request_status !== 'SUCCESS')) throw new ExpenseError('رفضت المنصة طلب الفواتير؛ تحقق من الصلاحيات وإعدادات الفوترة', 502);
  return data;
}
export async function invoicePage(provider: Provider, owner: string, credentials: Credentials, from: string, until: string, cursor?: string | null): Promise<{ invoices: Invoice[]; next: string | null }> {
  if (provider === 'meta') {
    const version = process.env.EXPENSE_META_API_VERSION || 'v25.0';
    if (!/^v\d+\.0$/.test(version)) throw new ExpenseError('إصدار Meta API غير صالح');
    const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(owner)}/business_invoices`);
    url.search = new URLSearchParams({ fields: 'id,invoice_id,invoice_date,billed_amount_details,billing_period,invoice_type,type,payment_status,cdn_download_uri,download_uri', issue_start_date: from, issue_end_date: until, limit: '25', ...(cursor ? { after: cursor } : {}) }).toString();
    const data = await api(url, provider, credentials);
    const paging = data.paging ? object(data.paging) : {};
    const after = paging.cursors ? object(paging.cursors).after : null;
    if (paging.next && typeof after !== 'string') throw new ExpenseError('مؤشر صفحات Meta غير صالح', 502);
    return { invoices: rows(data.data).map(row => normalizeInvoice(provider, row)), next: paging.next ? String(after) : null };
  }
  if (provider === 'tiktok') {
    const page = cursor ? Number(cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1) throw new ExpenseError('مؤشر الصفحة غير صالح', 502);
    const url = new URL('https://business-api.tiktok.com/open_api/v1.3/bc/invoice/get/');
    url.search = new URLSearchParams({ bc_id: owner, invoice_types: JSON.stringify(['RECON', 'CREDIT']), start_time: `${from} 00:00:00`, end_time: `${until} 23:59:59`, page: String(page), page_size: '25' }).toString();
    const data = object((await api(url, provider, credentials)).data);
    const pageInfo = object(data.page_info);
    if (!Number.isSafeInteger(Number(pageInfo.total_page))) throw new ExpenseError('معلومات صفحات TikTok غير متوافقة', 502);
    return { invoices: rows(data.invoice_list ?? data.list).map(row => normalizeInvoice(provider, row)), next: page < Number(pageInfo.total_page) ? String(page + 1) : null };
  }
  const url = new URL(`https://adsapi.snapchat.com/v1/adaccounts/${encodeURIComponent(owner)}/invoices`);
  const data = await api(url, provider, credentials);
  // Snap lists all invoices. Locally page the stable ID order to bound document downloads.
  const list = rows(data.invoices).map(wrapper => {
    if (wrapper.sub_request_status !== 'SUCCESS') throw new ExpenseError('تعذر قراءة فاتورة Snapchat', 502);
    return normalizeInvoice(provider, object(wrapper.invoice));
  }).filter(invoice => invoice.issueDate >= from && invoice.issueDate <= until).sort((a, b) => a.id.localeCompare(b.id));
  const remaining = cursor ? list.filter(invoice => invoice.id > cursor) : list;
  return { invoices: remaining.slice(0, 25), next: remaining.length > 25 ? remaining[24].id : null };
}
export async function checkInvoiceAccess(provider: Provider, owner: string, credentials: Credentials, from: string) {
  await invoicePage(provider, owner, credentials, from, today());
}
export async function invoicePdf(provider: Provider, owner: string, invoice: Invoice, credentials?: Credentials): Promise<Buffer | null> {
  if (invoice.pdfBase64) return validatePdf(Buffer.from(invoice.pdfBase64, 'base64'));
  if (provider === 'snapchat' && credentials) {
    const url = new URL(`https://adsapi.snapchat.com/v1/adaccounts/${encodeURIComponent(owner)}/invoices/${encodeURIComponent(invoice.id)}?include_pdf=true`);
    const data = await api(url, provider, credentials);
    const row = object(rows(data.invoices)[0]?.invoice);
    return typeof row.invoice_content === 'string' ? validatePdf(Buffer.from(row.invoice_content, 'base64')) : null;
  }
  if (!invoice.pdfUrl) return null;
  const url = new URL(invoice.pdfUrl);
  const suffixes = provider === 'meta' ? ['facebook.com', 'fbcdn.net'] : ['tiktok.com', 'tiktokcdn.com', 'byteoversea.com', 'ibytedtos.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !suffixes.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new ExpenseError('رابط مستند غير مدعوم؛ ارفع PDF يدوياً');
  // Signed provider URLs only. Never forward tokens or follow redirects to arbitrary hosts.
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!response.ok || !response.body) throw new ExpenseError('تعذر تنزيل مستند الفاتورة');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) throw new ExpenseError('حجم PDF يتجاوز الحد المسموح');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return validatePdf(Buffer.concat(chunks));
}
