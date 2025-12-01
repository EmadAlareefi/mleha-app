/**
 * Migration Script: Migrate users from single role to multi-role system
 *
 * This script migrates all existing users from the legacy single `role` field
 * to the new `UserRoleAssignment` table, enabling multiple roles per user.
 *
 * Usage:
 *   npx ts-node scripts/migrate-user-roles.ts
 */

import { prisma } from '../lib/prisma';
import { migrateAllUsersToRoleAssignments } from '../app/lib/user-roles';

async function main() {
  console.log('🚀 Starting user role migration...\n');

  try {
    const migrated = await migrateAllUsersToRoleAssignments();

    console.log(`\n✅ Migration completed successfully!`);
    console.log(`📊 Total users migrated: ${migrated}`);
    console.log(`\n✨ Users can now have multiple roles!`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
