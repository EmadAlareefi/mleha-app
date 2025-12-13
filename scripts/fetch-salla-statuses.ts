import { loadEnvConfig } from '@next/env';
import process from 'process';
import { PrismaClient } from '@prisma/client';
import { getSallaOrderStatuses } from '@/app/lib/salla-statuses';

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

async function fetchStatuses() {
  try {
    // Get the first merchant
    const merchant = await prisma.sallaAuth.findFirst({
      select: { merchantId: true }
    });

    if (!merchant) {
      console.log('No merchant found in database');
      return;
    }

    console.log(`Fetching statuses for merchant: ${merchant.merchantId}\n`);

    const statuses = await getSallaOrderStatuses(merchant.merchantId);

    console.log('=== ALL ORDER STATUSES ===\n');

    // Group statuses by parent
    const topLevel = statuses.filter(s => !s.parent || Object.keys(s.parent).length === 0);
    const children = statuses.filter(s => s.parent && Object.keys(s.parent).length > 0);

    topLevel.forEach(status => {
      console.log(`📋 ${status.name} (${status.slug})`);
      console.log(`   ID: ${status.id}`);
      console.log(`   Type: ${status.type}`);
      console.log(`   Icon: ${status.icon}`);
      console.log(`   Active: ${status.is_active}`);
      console.log(`   Sort: ${status.sort}`);

      if (status.original) {
        console.log(`   Original: ${status.original.name} (${status.original.id})`);
      }

      // Find children of this status
      const subStatuses = children.filter(c => c.parent?.id === status.id);
      if (subStatuses.length > 0) {
        console.log(`   Sub-statuses:`);
        subStatuses.forEach(sub => {
          console.log(`     ↳ ${sub.name} (${sub.slug}) - ${sub.type} - ID: ${sub.id}`);
        });
      }
      console.log('');
    });

    // Show orphaned children if any
    const orphans = children.filter(c => !topLevel.find(t => t.id === c.parent?.id));
    if (orphans.length > 0) {
      console.log('=== ORPHANED SUB-STATUSES ===\n');
      orphans.forEach(orphan => {
        console.log(`⚠️  ${orphan.name} (${orphan.slug})`);
        console.log(`   Parent ID: ${orphan.parent?.id} - ${orphan.parent?.name}`);
        console.log('');
      });
    }

    // Export as JSON
    console.log('\n=== JSON EXPORT ===\n');
    console.log(JSON.stringify(statuses, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fetchStatuses();
