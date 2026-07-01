/**
 * One-time migration: give every existing Tailor a real OrderUser login (role TAILOR,
 * granted the 'tailor-dashboard' service key) instead of the old bare accessCode gate.
 *
 * For each Tailor row missing `orderUserId`:
 *  - generates a username (slug of the tailor's name + a short unique suffix)
 *  - generates a random temporary password (bcrypt-hashed before storage)
 *  - creates the OrderUser, grants tailor-dashboard, links Tailor.orderUserId
 *
 * Prints a table of tailor name / username / temp password at the end so the
 * business can hand credentials to tailors out-of-band (passwords can't be
 * recovered afterward since only the hash is stored).
 *
 * Usage: node --import tsx scripts/migrate-tailors-to-order-users.ts [--dry-run]
 */
import { loadEnvConfig } from '@next/env';
import process from 'process';
import crypto from 'crypto';

loadEnvConfig(process.cwd());

const DRY_RUN = process.argv.includes('--dry-run');

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 24) || 'tailor';
}

function randomToken(length: number) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const { prisma } = await import('@/lib/prisma');
  const { setUserServiceKeys } = await import('@/app/lib/user-services');
  const { OrderUserRole } = await import('@prisma/client');

  const tailors = await prisma.tailor.findMany({ where: { orderUserId: null } });
  if (tailors.length === 0) {
    console.log('No tailors need migration - every Tailor already has an OrderUser link.');
    return;
  }

  console.log(`Found ${tailors.length} tailor(s) without a linked account.${DRY_RUN ? ' (dry run)' : ''}\n`);

  const results: Array<{ tailorName: string; username: string; tempPassword: string }> = [];

  for (const tailor of tailors) {
    const base = slugify(tailor.name);
    let username = base;
    let suffix = 0;
    // Ensure username uniqueness against existing OrderUser rows.
    // eslint-disable-next-line no-await-in-loop
    while (await prisma.orderUser.findUnique({ where: { username } })) {
      suffix += 1;
      username = `${base}.${suffix}`;
    }

    const tempPassword = randomToken(10);

    if (DRY_RUN) {
      console.log(`[dry-run] would create OrderUser "${username}" for tailor "${tailor.name}" (${tailor.id})`);
      results.push({ tailorName: tailor.name, username, tempPassword: '(dry-run, not created)' });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // eslint-disable-next-line no-await-in-loop
    const user = await prisma.orderUser.create({
      data: {
        username,
        password: hashedPassword,
        name: tailor.name,
        phone: tailor.phone,
        role: OrderUserRole.TAILOR,
        userType: 'employee',
        orderType: 'all',
        autoAssign: false,
        maxOrders: 0,
        isActive: tailor.isActive,
      },
    });

    // eslint-disable-next-line no-await-in-loop
    await setUserServiceKeys(user.id, ['tailor-dashboard']);
    // eslint-disable-next-line no-await-in-loop
    await prisma.tailor.update({ where: { id: tailor.id }, data: { orderUserId: user.id } });

    results.push({ tailorName: tailor.name, username, tempPassword });
    console.log(`Created OrderUser "${username}" for tailor "${tailor.name}" (${tailor.id})`);
  }

  console.log('\n=== Credentials to hand out (save this output - passwords cannot be recovered later) ===');
  console.log('tailor_name,username,temp_password');
  for (const row of results) {
    console.log(`${row.tailorName},${row.username},${row.tempPassword}`);
  }
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$disconnect();
  });
