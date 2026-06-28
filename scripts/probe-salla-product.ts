import { loadEnvConfig } from '@next/env';
import process from 'process';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';

loadEnvConfig(process.cwd());

const FIELD_RE = /sold|sales|order|qty|quantity|inventory|stock/i;

function describe(label: string, obj: unknown) {
  if (!obj || typeof obj !== 'object') {
    console.log(`\n${label}: <no object>`, obj);
    return;
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record);
  console.log(`\n${label} — ${keys.length} top-level keys:`);
  console.log(keys.join(', '));

  const interesting = keys.filter((key) => FIELD_RE.test(key));
  console.log(`\n${label} — keys matching /sold|sales|order|qty|quantity|inventory|stock/i:`);
  if (interesting.length === 0) {
    console.log('  (none)');
  } else {
    interesting.forEach((key) => {
      console.log(`  ${key} =`, JSON.stringify(record[key]));
    });
  }
}

async function main() {
  const resolved = await resolveSallaMerchantId();
  if (!resolved.merchantId) {
    console.error('Could not resolve merchant:', resolved.error);
    process.exit(1);
  }
  const merchantId = resolved.merchantId;
  console.log(`Merchant: ${merchantId}`);

  // 1) List payload — what a product looks like in /products
  const list = await sallaMakeRequest<{ data?: Array<Record<string, unknown>> }>(
    merchantId,
    '/products?per_page=3'
  );
  const first = list?.data?.[0];
  describe('LIST /products[0]', first);

  // 2) Detail payload — /products/{id} can carry more fields than the list
  const productId = first?.id;
  if (productId != null) {
    const detail = await sallaMakeRequest<{ data?: Record<string, unknown> }>(
      merchantId,
      `/products/${productId}`
    );
    describe(`DETAIL /products/${productId}`, detail?.data);

    // Print the full detail JSON once so we can eyeball any nested sold/stats objects.
    console.log('\nFull DETAIL payload JSON:');
    console.log(JSON.stringify(detail?.data, null, 2));
  } else {
    console.log('\nNo product id found in list payload; skipping detail fetch.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Probe failed:', error);
    process.exit(1);
  });
