/**
 * Creates the sandbox shipments AJEX asks for in its go-live checklist
 * ("Integration pre-production check list"): one COD and one prepaid (PP)
 * outbound shipment, plus one prepaid return pickup through the same code path
 * the returns flow uses. Each waybill PDF is saved next to a summary JSON.
 *
 *   AJEX_CLIENT_ID=... AJEX_CLIENT_SECRET=... AJEX_CUSTOMER_ACCOUNT=... \
 *   npx tsx scripts/ajex-test-shipments.ts [outputDir]
 *
 * Runs against the sandbox unless AJEX_API_ENVIRONMENT=production. The warehouse
 * address comes from AJEX_RETURN_WAREHOUSE_* (see RETURNS_SETUP.md), falling
 * back to a Riyadh test address.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createAjexOrder,
  fetchAjexLabel,
  getAjexConfig,
  type AjexCreateOrderRequest,
} from '../app/lib/ajex-api';
import {
  buildAjexReturnOrder,
  buildAjexReturnReference,
  buildWarehouseDeliveryAddress,
  getAjexReturnWarehouse,
  type AjexWarehouseAddress,
} from '../app/lib/returns/ajex-return-shipment';

const OUTBOUND_PRODUCT_CODE = process.env.AJEX_OUTBOUND_PRODUCT_CODE || 'AJEX DCE';
const COD_AMOUNT = Number(process.env.AJEX_TEST_COD_AMOUNT || '150');

const warehouse: AjexWarehouseAddress = getAjexReturnWarehouse() ?? {
  name: 'Mleha Warehouse (TEST)',
  phone: '+966500000000',
  city: 'Riyadh',
  district: 'Al Olaya',
  addressLine1: 'King Fahd Road, Al Olaya',
};

// A test consignee in Jeddah, shaped like a Salla order so the return builder
// maps it exactly as it would a real customer.
const testOrder = {
  id: 0,
  reference_id: 'TEST',
  customer: { first_name: 'Test', last_name: 'Customer', mobile: '555555555', mobile_code: '+966' },
  shipping: {
    receiver: { name: 'Test Customer', phone: '+966555555555' },
    ship_to: {
      city: 'جدة',
      block: 'الروضة',
      address_line: 'Prince Sultan Street, Ar Rawdah',
      postal_code: '23435',
    },
  },
};

const testItems = [{ productName: 'Test Abaya', productSku: 'TEST-SKU-1', quantity: 1, price: COD_AMOUNT }];

async function run() {
  const config = getAjexConfig();
  if (!config) {
    throw new Error('Set AJEX_CLIENT_ID and AJEX_CLIENT_SECRET (and AJEX_CUSTOMER_ACCOUNT).');
  }

  const outputDir = path.resolve(process.argv[2] || 'ajex-test-shipments');
  await mkdir(outputDir, { recursive: true });
  console.log(`AJEX ${config.baseUrl} as ${config.customerAccount}`);

  // The return builder maps the consignee; outbound shipments reverse it.
  const mapped = buildAjexReturnOrder({
    order: testOrder,
    items: testItems,
    warehouse,
    referenceNumber: buildAjexReturnReference('TEST'),
    currency: 'SAR',
  });
  if (!mapped.ok) throw new Error(mapped.error);
  const consignee = mapped.request.pickupAddress;
  const shipper = buildWarehouseDeliveryAddress(warehouse);

  const stamp = Date.now().toString(36).toUpperCase();
  const outbound = (cod: boolean): Omit<AjexCreateOrderRequest, 'customerAccount'> => ({
    ...mapped.request,
    referenceNumber: `TEST-${cod ? 'COD' : 'PP'}-${stamp}`,
    productCode: OUTBOUND_PRODUCT_CODE,
    cod,
    codAmount: cod ? COD_AMOUNT : 0,
    pickupAddress: shipper,
    deliveryAddress: consignee,
  });

  const shipments = [
    { name: 'cod', label: 'Order creation with COD', request: outbound(true) },
    { name: 'prepaid', label: 'Order creation without COD (PP)', request: outbound(false) },
    { name: 'return', label: 'Return pickup (PP)', request: mapped.request },
  ];

  const summary: Record<string, unknown>[] = [];
  for (const shipment of shipments) {
    const result = await createAjexOrder(shipment.request);
    if (!result.success) {
      console.error(`✗ ${shipment.label}: ${result.error}`);
      summary.push({ shipment: shipment.name, success: false, error: result.error, response: result.raw });
      continue;
    }

    const { trackingId, waybillFileUrl } = result.data;
    let pdfPath: string | null = null;
    const label = await fetchAjexLabel(trackingId);
    if (label.success) {
      pdfPath = path.join(outputDir, `${shipment.name}-${trackingId}.pdf`);
      await writeFile(pdfPath, label.pdf);
    } else {
      console.warn(`  label download failed for ${trackingId}: ${label.error}`);
    }

    console.log(`✓ ${shipment.label}: waybill ${trackingId}${shipment.request.cod ? ` (COD ${shipment.request.codAmount} SAR)` : ''}`);
    if (pdfPath) console.log(`  PDF: ${pdfPath}`);
    summary.push({
      shipment: shipment.name,
      success: true,
      referenceNumber: shipment.request.referenceNumber,
      productCode: shipment.request.productCode,
      cod: shipment.request.cod,
      codAmount: shipment.request.codAmount,
      trackingId,
      waybillFileUrl,
      pdfPath,
    });
  }

  const summaryPath = path.join(outputDir, 'summary.json');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Summary: ${summaryPath}`);

  if (summary.some((entry) => !entry.success)) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
