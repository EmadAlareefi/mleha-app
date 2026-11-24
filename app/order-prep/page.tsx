export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { getStateForUser } from '@/app/lib/order-prep/queue';
import { getPrepSettings } from '@/app/lib/order-prep/settings';
import { prisma } from '@/lib/prisma';
import PrepApp from './_components/PrepApp';

/**
 * /order-prep: the packing page. It renders the packer's current orders on the
 * server — no claim, no Salla call — so the first paint already shows the order.
 */
export default async function OrderPrepPage() {
  const settings = await getPrepSettings();

  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  const orderUser =
    session && sessionUserId && hasServiceAccess(session, ['order-prep'])
      ? await prisma.orderUser.findUnique({ where: { id: sessionUserId }, select: { id: true } })
      : null;

  if (!orderUser) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-base font-semibold text-foreground">
          هذا الحساب غير مضاف ضمن مستخدمي التحضير. يرجى استخدام حساب تحضير خاص بك.
        </p>
        <Link href="/" className="rounded-xl border bg-card px-4 py-2 text-sm font-semibold">
          الرئيسية
        </Link>
      </main>
    );
  }

  const initialState = await getStateForUser(orderUser.id).catch(() => null);
  return <PrepApp initialState={initialState} scanMode={settings.scanMode} userId={orderUser.id} />;
}
