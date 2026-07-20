import path from 'path';
import { config as loadEnv } from 'dotenv';

// Load .env before importing modules that read process.env at import time.
loadEnv({ path: path.resolve(process.cwd(), '.env') });

import { env } from '@/app/lib/env';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';

async function main() {
  const to = process.argv[2] || '+966501466365';

  console.log('Sending exchange_coupon_notification_new test via Zoko');
  console.log('  template:', env.ZOKO_TPL_EXCHANGE_COUPON);
  console.log('  language:', env.WHATSAPP_DEFAULT_LANG);
  console.log('  recipient:', to);

  // Dummy data — exercises all 5 template placeholders {{1}}..{{5}}
  const result = await notifyExchangeCoupon({
    customerName: 'أحمد التجريبي', // {{1}}
    customerPhone: to,
    orderNumber: 'TEST-12345', // {{5}}
    couponCode: 'EXTEST1234', // {{2}}
    discountedAmount: 383.48, // -> {{3}} "383.48 (441.00 شامل الضريبة)"
    fullAmount: 441.0,
    expiryDate: new Date('2026-07-21'), // {{4}}
  });

  console.log('\nResult:', JSON.stringify(result, null, 2));

  if (result.status !== 'sent') {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
