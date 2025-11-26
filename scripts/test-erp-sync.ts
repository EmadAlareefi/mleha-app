/**
 * Test script to verify ERP invoice payload generation
 * Run with: npx ts-node scripts/test-erp-sync.ts
 */

import { prisma } from '../lib/prisma';
import { transformOrderToERPInvoice, syncOrderToERP } from '../app/lib/erp-invoice';
import { log as logger } from '../app/lib/logger';

async function testERPSync() {
  try {
    console.log('Fetching a test order...\n');

    // Find an order that hasn't been synced yet (or any order for testing)
    const order = await prisma.sallaOrder.findFirst({
      orderBy: { placedAt: 'desc' },
      take: 1,
    });

    if (!order) {
      console.log('No orders found in database');
      return;
    }

    console.log('Testing with order:');
    console.log(`  Order ID: ${order.orderId}`);
    console.log(`  Order Number: ${order.orderNumber}`);
    console.log(`  Status: ${order.statusSlug}`);
    console.log(`  Payment Method: ${order.paymentMethod}`);
    console.log(`  Total: ${order.totalAmount}`);
    console.log(`  Subtotal: ${order.subtotalAmount}`);
    console.log(`  Tax: ${order.taxAmount}`);
    console.log(`  Shipping: ${order.shippingAmount}`);
    console.log(`  Discount: ${order.discountAmount}`);
    console.log(`  Already Synced: ${order.erpSyncedAt ? 'Yes' : 'No'}`);
    console.log('\n' + '='.repeat(80) + '\n');

    // Transform to ERP payload
    console.log('Transforming order to ERP invoice payload...\n');
    const payload = await transformOrderToERPInvoice(order);

    console.log('ERP Invoice Payload:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n' + '='.repeat(80) + '\n');

    // Analyze items
    console.log('Items Breakdown:');
    console.log(`  Total Items: ${payload.API_Inv.length}`);

    payload.API_Inv.forEach((item, index) => {
      console.log(`\n  Item ${index + 1}:`);
      console.log(`    cmbkey: ${item.cmbkey}`);
      console.log(`    barcode: ${item.barcode}`);
      console.log(`    qty: ${item.qty}`);
      console.log(`    price: ${item.price}`);
      console.log(`    discpc: ${item.discpc}%`);

      // Identify special items
      if (item.barcode === '019') {
        console.log(`    ⚠️ SHIPPING ITEM`);
      } else if (item.barcode === '000') {
        console.log(`    ⚠️ COD FEE ITEM`);
      } else if (item.barcode === '05147') {
        console.log(`    ⚠️ PACKAGING/OPTION ITEM`);
      }
    });

    console.log('\n' + '='.repeat(80) + '\n');

    // Test sync (will use debug mode, so won't actually post to ERP)
    console.log('Testing sync to ERP (DEBUG MODE - no actual API call)...\n');
    const result = await syncOrderToERP(order, true); // force=true to re-sync

    console.log('Sync Result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ ERP sync test completed successfully!');
      console.log(`   ERP Invoice ID: ${result.erpInvoiceId}`);
    } else {
      console.log('\n❌ ERP sync test failed!');
      console.log(`   Error: ${result.error}`);
    }

  } catch (error: any) {
    console.error('Error in test script:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testERPSync();
