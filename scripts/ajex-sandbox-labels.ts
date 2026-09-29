/**
 * Creates the test orders AJEX's go-live checklist asks for, on the AJEX AONE
 * sandbox, and saves their waybill PDFs:
 *   - with_cod    AJEX DCE delivery with cash on delivery
 *   - without_cod AJEX DCE delivery, prepaid
 *   - return      AJEX RPU reverse pickup (customer → warehouse), the flow returns use
 *
 * Credentials come from .env.local (AJEX_CLIENT_ID, AJEX_CLIENT_SECRET,
 * AJEX_CUSTOMER_ACCOUNT). Only dummy test contacts are sent.
 *
 *   npm run ajex:sandbox-labels -- --out <dir> [--cod 150]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ShipmentAddress } from '@/app/lib/smsa-api';
import {
  buildAjexOrderPayload,
  createAjexOrder,
  getAjexLabelPdf,
  isAjexConfigured,
  readAjexConfig,
} from '@/app/lib/ajex-api';

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const outDir = path.resolve(arg('out') ?? 'tmp/ajex-golive');
const codAmount = Number(arg('cod') ?? 150);

const config = readAjexConfig();
if (!isAjexConfigured(config)) {
  console.error('Set AJEX_CLIENT_ID, AJEX_CLIENT_SECRET and AJEX_CUSTOMER_ACCOUNT first.');
  process.exit(1);
}
if (config.environment !== 'sandbox' || !config.authUrl.includes('-stage.aj-ex.com')) {
  console.error(`Refusing to create test orders outside the AJEX sandbox (${config.authUrl}).`);
  process.exit(1);
}

// Addresses whose AJEX mappings and national short addresses the sandbox accepts.
const warehouse: ShipmentAddress = {
  ContactName: 'Mleha AJEX Sandbox Warehouse',
  ContactPhoneNumber: '+966500000000',
  AddressLine1: 'AJEX sandbox integration test, Al Rayyan, Jeddah',
  City: 'Jeddah',
  District: 'Al Rayyan',
  PostalCode: '23435',
  ShortCode: 'JIEA8567',
  Country: 'Saudi Arabia',
};
const testCustomer: ShipmentAddress = {
  ContactName: 'AJEX Sandbox Test Customer',
  ContactPhoneNumber: '+966500000001',
  AddressLine1: 'AJEX sandbox integration test, Al Malaz, Riyadh',
  City: 'Riyadh',
  District: 'الملز',
  PostalCode: '12812',
  ShortCode: 'REMA2766',
  Country: 'Saudi Arabia',
};

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const delivery = (key: string, cod: number) =>
  buildAjexOrderPayload({
    referenceNumber: `MLEHA-${stamp}-${key}`,
    productCode: config.deliveryProductCode,
    pickup: warehouse,
    delivery: testCustomer,
    pieces: 1,
    weightKg: 1,
    declaredValue: cod || 250,
    currency: 'SAR',
    description: `Mleha AJEX sandbox ${key} test item`,
    codAmount: cod,
  });

const cases = [
  { key: 'with_cod', label: 'Order creation with COD', codAmount, payload: delivery('COD', codAmount) },
  { key: 'without_cod', label: 'Order creation without COD', codAmount: 0, payload: delivery('PP', 0) },
  {
    key: 'return',
    label: 'Return pickup (AJEX RPU)',
    codAmount: 0,
    payload: buildAjexOrderPayload({
      referenceNumber: `MLEHA-${stamp}-RET`,
      productCode: config.returnProductCode,
      pickup: testCustomer,
      delivery: warehouse,
      pieces: 1,
      weightKg: 1,
      declaredValue: 250,
      currency: 'SAR',
      description: 'Mleha AJEX sandbox return test item',
    }),
  },
];

async function main() {
  mkdirSync(outDir, { recursive: true });
  const results: Record<string, unknown>[] = [];

  for (const testCase of cases) {
    const result = await createAjexOrder(testCase.payload);
    writeFileSync(
      path.join(outDir, `${testCase.key}.json`),
      JSON.stringify({ request: testCase.payload, response: result.rawResponse }, null, 2),
    );
    if (!result.success || !result.trackingNumber) {
      console.error(`${testCase.label}: FAILED ${result.errorCode ?? ''} ${result.error ?? ''}`);
      results.push({ key: testCase.key, success: false, error: result.error, response: result.rawResponse });
      continue;
    }

    const pdf = await getAjexLabelPdf(result.trackingNumber, result.labelUrl);
    const pdfFile = pdf ? path.join(outDir, `${result.trackingNumber}.pdf`) : null;
    if (pdf && pdfFile) writeFileSync(pdfFile, pdf);

    console.log(`${testCase.label}: waybill ${result.trackingNumber}${pdfFile ? ` → ${pdfFile}` : ' (PDF download failed)'}`);
    results.push({
      key: testCase.key,
      success: true,
      referenceNumber: testCase.payload.referenceNumber,
      productCode: testCase.payload.productCode,
      codAmount: testCase.codAmount,
      currency: 'SAR',
      waybillNumber: result.trackingNumber,
      pdfFile,
    });
  }

  const summary = { createdAt: new Date().toISOString(), customerAccount: config.customerAccount, results };
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(summary, null, 2));
  console.log(`Summary: ${path.join(outDir, 'results.json')}`);
  if (results.some((entry) => !entry.success)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
