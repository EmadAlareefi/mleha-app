/**
 * Initialize ERP Settings
 *
 * Run this script to set up default ERP settings in the database:
 * npx ts-node scripts/init-erp-settings.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Initializing ERP settings...');

  const settings = [
    {
      key: 'erp_auto_sync_enabled',
      value: 'false',
      description: 'Automatically sync orders to ERP when status changes',
    },
    {
      key: 'erp_auto_sync_on_status',
      value: 'completed,ready_to_ship',
      description: 'Order statuses that trigger automatic ERP sync (comma-separated)',
    },
    {
      key: 'erp_sync_delay_seconds',
      value: '0',
      description: 'Delay in seconds before syncing to ERP (useful for batch processing)',
    },
  ];

  for (const setting of settings) {
    const existing = await prisma.settings.findUnique({
      where: { key: setting.key },
    });

    if (existing) {
      console.log(`✓ Setting already exists: ${setting.key} = ${existing.value}`);
    } else {
      await prisma.settings.create({
        data: setting,
      });
      console.log(`✓ Created setting: ${setting.key} = ${setting.value}`);
    }
  }

  console.log('\nERP settings initialized successfully!');
  console.log('\nCurrent settings:');
  console.log('- erp_auto_sync_enabled: false (automatic sync disabled by default)');
  console.log('- erp_auto_sync_on_status: completed,ready_to_ship');
  console.log('- erp_sync_delay_seconds: 0');
  console.log('\nTo enable auto-sync, update the setting via API or database:');
  console.log('  await prisma.settings.update({');
  console.log('    where: { key: "erp_auto_sync_enabled" },');
  console.log('    data: { value: "true" }');
  console.log('  });');
}

main()
  .catch((e) => {
    console.error('Error initializing settings:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
