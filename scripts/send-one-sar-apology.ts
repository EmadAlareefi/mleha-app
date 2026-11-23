/**
 * Sends the Zoko template `1_rsa` (apology + ONESAROFFER coupon) to customers
 * whose 1-SAR-offer orders were cancelled.
 *
 * Input: an Excel sheet with columns [order reference, phone]. Names come from
 * SallaOrder.customerName. One message per phone, even if it had several orders.
 *
 * Usage:
 *   npm run zoko:one-sar-apology -- <file.xlsx>                       dry run
 *   npm run zoko:one-sar-apology -- <file.xlsx> --apply --only=+9665…  send to one number
 *   npm run zoko:one-sar-apology -- <file.xlsx> --apply               send to everyone
 *
 * Every send is appended to scripts/output/one-sar-apology-log.csv; phones
 * already logged as sent are skipped, so re-running is safe.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { getZokoTemplates, sendWhatsAppTemplateByType } from '@/app/lib/zoko';

const TEMPLATE_ID = '1_rsa';
const COUPON = 'ONESAROFFER';
const FALLBACK_NAME = 'عميلتنا';
const DELAY_MS = 300;
const LOG_PATH = path.join(process.cwd(), 'scripts/output/one-sar-apology-log.csv');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const onlyArg = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const filePath = args.find((a) => !a.startsWith('--'));

function normalizePhone(raw: unknown): string | null {
  let p = String(raw ?? '').replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (/^05\d{8}$/.test(p)) p = `+966${p.slice(1)}`;
  else if (/^5\d{8}$/.test(p)) p = `+966${p}`;
  else if (/^9665\d{8}$/.test(p)) p = `+${p}`;
  else if (/^\d{10,15}$/.test(p)) p = `+${p}`;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function alreadySent(): Set<string> {
  if (!fs.existsSync(LOG_PATH)) return new Set();
  const sent = new Set<string>();
  for (const line of fs.readFileSync(LOG_PATH, 'utf8').split('\n').slice(1)) {
    const [phone, , , status] = line.split(',');
    if (status === 'sent') sent.add(phone);
  }
  return sent;
}

async function main() {
  if (!filePath) throw new Error('Pass the Excel file path as the first argument');

  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }).slice(1);

  let empty = 0;
  const badPhones: string[] = [];
  const entries: { ref: string; phone: string }[] = [];
  for (const row of rows) {
    const ref = String(row[0] ?? '').trim();
    const rawPhone = String(row[1] ?? '').trim();
    if (!ref && !rawPhone) { empty++; continue; }
    const phone = normalizePhone(rawPhone);
    if (!phone) { badPhones.push(`${ref} / ${rawPhone}`); continue; }
    entries.push({ ref, phone });
  }

  const refs = [...new Set(entries.map((e) => e.ref).filter(Boolean))];
  const orders = await prisma.sallaOrder.findMany({
    where: { OR: [{ referenceId: { in: refs } }, { orderNumber: { in: refs } }] },
    select: { referenceId: true, orderNumber: true, customerName: true },
  });
  const nameByRef = new Map<string, string | null>();
  for (const o of orders) {
    const name = firstName(o.customerName);
    for (const key of [o.referenceId, o.orderNumber]) {
      if (key && !nameByRef.get(key)) nameByRef.set(key, name);
    }
  }

  const recipients = new Map<string, { phone: string; refs: string[]; name: string | null }>();
  for (const { ref, phone } of entries) {
    const r = recipients.get(phone) ?? { phone, refs: [], name: null };
    r.refs.push(ref);
    r.name ||= nameByRef.get(ref) ?? null;
    recipients.set(phone, r);
  }

  const unmatchedRefs = refs.filter((r) => !nameByRef.has(r));
  const all = [...recipients.values()];
  console.log(`rows: ${rows.length}, empty: ${empty}, unparseable phones: ${badPhones.length}`);
  if (badPhones.length) console.log('  unparseable:', badPhones);
  console.log(`unique order refs: ${refs.length}, found in DB: ${refs.length - unmatchedRefs.length}`);
  if (unmatchedRefs.length) console.log('  not in DB:', unmatchedRefs.join(', '));
  console.log(`unique phones: ${all.length}, with name: ${all.filter((r) => r.name).length}, fallback "${FALLBACK_NAME}": ${all.filter((r) => !r.name).length}`);
  console.log('sample:', all.slice(0, 10).map((r) => `${r.phone} → ${r.name ?? FALLBACK_NAME}`));

  const template = (await getZokoTemplates()).find((t) => t.templateId === TEMPLATE_ID);
  console.log('template:', template);
  if (!template || !template.active) throw new Error(`Zoko template ${TEMPLATE_ID} not found or not active`);
  if (template.templateVariableCount !== 2) throw new Error(`Expected 2 variables, template has ${template.templateVariableCount}`);

  let targets = all;
  if (onlyArg) {
    const only = normalizePhone(onlyArg);
    const match = all.find((r) => r.phone === only);
    targets = [match ?? { phone: only!, refs: ['test'], name: null }];
    console.log(`--only: sending to ${only}${match ? '' : ' (not in the sheet, test send)'}`);
  }
  const sent = alreadySent();
  const skipped = targets.filter((r) => sent.has(r.phone)).length;
  targets = targets.filter((r) => !sent.has(r.phone));
  console.log(`to send: ${targets.length} (already sent, skipped: ${skipped})`);

  if (!apply) {
    console.log('dry run, nothing sent. Add --apply to send.');
    return;
  }

  if (!fs.existsSync(LOG_PATH)) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, 'phone,refs,name,status,providerId,error,at\n');
  }

  let ok = 0;
  let failed = 0;
  for (const [i, r] of targets.entries()) {
    const name = r.name ?? FALLBACK_NAME;
    let status = 'sent';
    let providerId = '';
    let error = '';
    try {
      const res: any = await sendWhatsAppTemplateByType({
        to: r.phone,
        templateId: template.templateId,
        templateLanguage: template.templateLanguage,
        templateType: template.templateType,
        templateArgs: [name, COUPON],
      });
      providerId = String(res?.messageId ?? res?.id ?? '');
      ok++;
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : String(e);
      failed++;
    }
    fs.appendFileSync(
      LOG_PATH,
      [r.phone, r.refs.join(' '), name, status, providerId, error, new Date().toISOString()].map(csvCell).join(',') + '\n',
    );
    console.log(`[${i + 1}/${targets.length}] ${r.phone} ${status}${error ? `: ${error.slice(0, 200)}` : ''}`);
    await new Promise((res) => setTimeout(res, DELAY_MS));
  }
  console.log(`done: sent ${ok}, failed ${failed}. Log: ${LOG_PATH}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
