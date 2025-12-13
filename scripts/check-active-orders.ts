import { loadEnvConfig } from '@next/env';
import process from 'process';
import { PrismaClient } from '@prisma/client';

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

async function checkActiveOrders() {
  try {
    console.log('Checking for active order assignments...\n');

    // Get all active assignments (not completed)
    const activeAssignments = await prisma.orderAssignment.findMany({
      where: {
        completedAt: null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        assignedAt: 'desc',
      },
    });

    console.log(`Found ${activeAssignments.length} active order assignments\n`);

    if (activeAssignments.length === 0) {
      console.log('No active orders found.');
      console.log('\nThis means:');
      console.log('- All assigned orders have been completed');
      console.log('- OR no orders have been assigned yet');
      console.log('\nTo see data in the admin page, you need to:');
      console.log('1. Go to the order prep page (/order-prep) as an orders user');
      console.log('2. Orders will be auto-assigned');
      console.log('3. Then check the admin page to see them');
    } else {
      console.log('Active Orders:');
      console.log('='.repeat(80));

      activeAssignments.forEach((assignment, index) => {
        console.log(`\n${index + 1}. Order #${assignment.orderNumber}`);
        console.log(`   Assigned to: ${(assignment.user as any)?.name || 'Unknown'}`);
        console.log(`   Status: ${assignment.status}`);
        console.log(`   Salla Status: ${assignment.sallaStatus || 'Not set'}`);
        console.log(`   Assigned at: ${assignment.assignedAt.toLocaleString('ar-SA')}`);
        console.log(`   Started: ${assignment.startedAt ? assignment.startedAt.toLocaleString('ar-SA') : 'Not started'}`);
      });
    }

    // Show stats by user
    const userStats = new Map<string, { name: string; count: number }>();
    activeAssignments.forEach(a => {
      const userId = a.userId;
      const userName = (a.user as any)?.name || 'Unknown';

      if (!userStats.has(userId)) {
        userStats.set(userId, { name: userName, count: 0 });
      }
      userStats.get(userId)!.count++;
    });

    if (userStats.size > 0) {
      console.log('\n\nActive Orders by User:');
      console.log('='.repeat(80));
      userStats.forEach((stats, userId) => {
        console.log(`${stats.name}: ${stats.count} orders`);
      });
    }

    // Show total assignments (including completed)
    const totalAssignments = await prisma.orderAssignment.count();
    const completedAssignments = await prisma.orderAssignment.count({
      where: { completedAt: { not: null } },
    });

    console.log('\n\nTotal Statistics:');
    console.log('='.repeat(80));
    console.log(`Total assignments ever: ${totalAssignments}`);
    console.log(`Completed: ${completedAssignments}`);
    console.log(`Active: ${activeAssignments.length}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkActiveOrders();
