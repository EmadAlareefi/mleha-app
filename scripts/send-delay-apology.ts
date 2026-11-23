/**
 * Sends the Zoko template `19_11_26_template_4a61` (late-order apology + personal
 * 15% / free-shipping code) to the customers in an Excel sheet with columns
 * [order number, phone, customer name, discount code].
 *
 * Usage:
 *   npm run zoko:delay-apology -- <file.xlsx>                          dry run
 *   npm run zoko:delay-apology -- <file.xlsx> --apply --only=05…       test send (uses the first row's name/code)
 *   npm run zoko:delay-apology -- <file.xlsx> --apply                  send to everyone
 *
 * Every send is appended to scripts/output/delay-apology-log.csv; phones already
 * logged as sent are skipped, so re-running is safe.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { getZokoTemplates, sendWhatsAppTemplateByType } from '@/app/lib/zoko';

const TEMPLATE_ID = '19_11_26_template_4a61';
const FALLBACK_NAME = 'عميلتنا';
const DELAY_MS = 300;
const LOG_PATH = path.join(process.cwd(), 'scripts/output/delay-apology-log.csv');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const onlyArg = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const filePath = args.find((a) => !a.startsWith('--'));

function normalizePhone(raw: unknown): string | null {
  let p = String(raw ?? '').replace(/[\s\-()'’]/g, '');
  if (!p) return null;
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (/^05\d{8}$/.test(p)) p = `+966${p.slice(1)}`;
  else if (/^5\d{8}$/.test(p)) p = `+966${p}`;
  else if (/^9665\d{8}$/.test(p)) p = `+${p}`;
  else if (/^\d{10,15}$/.test(p)) p = `+${p}`;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function alreadySent(): Set<string> {
  if (!fs.existsSync(LOG_PATH)) return new Set();
  const sent = new Set<string>();
  for (const line of fs.readFileSync(LOG_PATH, 'utf8').split('\n').slice(1)) {
    const [phone, , , , status] = line.split(',');
    if (status === 'sent') sent.add(phone);
  }
  return sent;
}

type Recipient = { phone: string; ref: string; name: string; code: string };

async function main() {
  if (!filePath) throw new Error('Pass the Excel file path as the first argument');

  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }).slice(1);

  const problems: string[] = [];
  const byPhone = new Map<string, Recipient>();
  for (const row of rows) {
    const [refRaw, phoneRaw, nameRaw, codeRaw] = row.map((c) => String(c ?? '').trim());
    if (!refRaw && !phoneRaw && !nameRaw && !codeRaw) continue;
    const phone = normalizePhone(phoneRaw);
    if (!phone || !codeRaw) { problems.push(`${refRaw} / ${phoneRaw} / code=${codeRaw}`); continue; }
    if (byPhone.has(phone)) { problems.push(`duplicate phone ${phone} (${refRaw}), kept first row`); continue; }
    byPhone.set(phone, { phone, ref: refRaw, name: nameRaw.split(/\s+/)[0] || FALLBACK_NAME, code: codeRaw });
  }
  const all = [...byPhone.values()];
  console.log(`recipients: ${all.length}, problems: ${problems.length}`);
  if (problems.length) console.log('  problems:', problems);
  for (const r of all) console.log(`  ${r.ref}  ${r.phone}  name=${r.name}  code=${r.code}`);

  const template = (await getZokoTemplates()).find((t) => t.templateId === TEMPLATE_ID);
  if (!template || !template.active) throw new Error(`Zoko template ${TEMPLATE_ID} not found or not active`);
  if (template.templateVariableCount !== 2) throw new Error(`Expected 2 variables, template has ${template.templateVariableCount}`);

  let targets = all;
  if (onlyArg) {
    const only = normalizePhone(onlyArg);
    if (!only) throw new Error(`Bad --only phone: ${onlyArg}`);
    const match = all.find((r) => r.phone === only);
    targets = [match ?? { ...all[0], phone: only, ref: 'test' }];
    console.log(`--only: sending to ${only}${match ? '' : ` (test send with ${all[0].name}/${all[0].code})`}`);
  }
  const sent = alreadySent();
  const skipped = targets.filter((r) => sent.has(r.phone)).length;
  if (!onlyArg) targets = targets.filter((r) => !sent.has(r.phone));
  console.log(`to send: ${targets.length} (already sent, skipped: ${onlyArg ? 0 : skipped})`);

  if (!apply) { console.log('dry run, nothing sent. Add --apply to send.'); return; }

  if (!fs.existsSync(LOG_PATH)) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, 'phone,ref,name,code,status,providerId,error,at\n');
  }

  let ok = 0, failed = 0;
  for (const [i, r] of targets.entries()) {
    let status = onlyArg ? 'test' : 'sent';
    let providerId = '', error = '';
    try {
      const res: any = await sendWhatsAppTemplateByType({
        to: r.phone,
        templateId: template.templateId,
        templateLanguage: template.templateLanguage,
        templateType: template.templateType,
        templateArgs: [r.name, r.code],
      });
      providerId = String(res?.messageId ?? res?.id ?? '');
      ok++;
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : String(e);
      failed++;
    }
    fs.appendFileSync(LOG_PATH, [r.phone, r.ref, r.name, r.code, status, providerId, error, new Date().toISOString()].map(csvCell).join(',') + '\n');
    console.log(`[${i + 1}/${targets.length}] ${r.phone} ${status}${error ? `: ${error.slice(0, 200)}` : ''}`);
    await new Promise((res) => setTimeout(res, DELAY_MS));
  }
  console.log(`done: ok ${ok}, failed ${failed}. Log: ${LOG_PATH}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
