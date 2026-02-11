import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { DeliveryAgentWalletTransactionType } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { recordDeliveryAgentWalletPayout } from '@/app/lib/delivery-agent-wallet';

export const runtime = 'nodejs';

const ADMIN_ROLES = new Set(['admin', 'warehouse', 'accountant']);

const hasPrivilegedAccess = (user: any) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [];
  return roles.some((role) => ADMIN_ROLES.has(role));
};

const isDeliveryAgent = (user: any) => {
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [];
  return roles.includes('delivery_agent');
};

const decimalToNumber = (value: any) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
};

const formatTransaction = (transaction: any) => ({
  ...transaction,
  amount: decimalToNumber(transaction.amount),
});

type StatSnapshot = {
  count: number;
  total: number;
};

const emptySnapshot = (): StatSnapshot => ({ count: 0, total: 0 });

const buildStats = (
  typeGroups: {
    type: DeliveryAgentWalletTransactionType;
    _count: { _all: number };
    _sum: { amount: any };
  }[]
): {
  shipments: StatSnapshot;
  tasks: StatSnapshot;
  payouts: StatSnapshot;
  adjustments: StatSnapshot;
  totalEarned: number;
  totalPaid: number;
} => {
  const map: Partial<Record<DeliveryAgentWalletTransactionType, StatSnapshot>> = {};

  for (const group of typeGroups) {
    map[group.type] = {
      count: group._count._all,
      total: decimalToNumber(group._sum.amount),
    };
  }

  const shipments = map[DeliveryAgentWalletTransactionType.SHIPMENT_COMPLETED] || emptySnapshot();
  const tasks = map[DeliveryAgentWalletTransactionType.TASK_COMPLETED] || emptySnapshot();
  const payouts = map[DeliveryAgentWalletTransactionType.PAYOUT] || emptySnapshot();
  const adjustments = map[DeliveryAgentWalletTransactionType.ADJUSTMENT] || emptySnapshot();

  return {
    shipments,
    tasks,
    payouts,
    adjustments,
    totalEarned: shipments.total + tasks.total + Math.max(0, adjustments.total),
    totalPaid: Math.abs(payouts.total + Math.min(0, adjustments.total)),
  };
};

async function getDeliveryAgentWallet(
  deliveryAgentId: string,
  options?: { includeTransactions?: boolean }
) {
  const [agent, balanceAggregate, stats, recentTransactions] = await Promise.all([
    prisma.orderUser.findUnique({
      where: {
        id: deliveryAgentId,
        servicePermissions: {
          some: { serviceKey: 'my-deliveries' },
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
        phone: true,
      },
    }),
    prisma.deliveryAgentWalletTransaction.aggregate({
      where: { deliveryAgentId },
      _sum: { amount: true },
    }),
    prisma.deliveryAgentWalletTransaction.groupBy({
      where: { deliveryAgentId },
      by: ['type'],
      _count: { _all: true },
      _sum: { amount: true },
    }),
    options?.includeTransactions
      ? prisma.deliveryAgentWalletTransaction.findMany({
          where: { deliveryAgentId },
          orderBy: { createdAt: 'desc' },
          take: 25,
        })
      : Promise.resolve([]),
  ]);

  if (!agent) {
    return null;
  }

  const statsSummary = buildStats(stats);

  return {
    agent,
    balance: decimalToNumber(balanceAggregate._sum.amount),
    stats: statsSummary,
    recentTransactions: (recentTransactions as any[]).map((transaction) => ({
      ...transaction,
      amount: decimalToNumber(transaction.amount),
    })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const searchParams = request.nextUrl.searchParams;
    const deliveryAgentIdParam = searchParams.get('deliveryAgentId');
    const includeTransactions = searchParams.get('includeTransactions') === 'true';

    const privileged = hasPrivilegedAccess(user);
    const agentSelfAccess = isDeliveryAgent(user);

    let resolvedAgentId: string | null = null;
    if (deliveryAgentIdParam === 'me') {
      resolvedAgentId = user.id;
    } else if (deliveryAgentIdParam) {
      resolvedAgentId = deliveryAgentIdParam;
    }

    if (resolvedAgentId) {
      if (!privileged && (!agentSelfAccess || resolvedAgentId !== user.id)) {
        return NextResponse.json(
          { error: 'ليس لديك صلاحية لعرض هذه المحفظة' },
          { status: 403 }
        );
      }

      const wallet = await getDeliveryAgentWallet(resolvedAgentId, {
        includeTransactions,
      });

      if (!wallet) {
        return NextResponse.json({ error: 'المندوب غير موجود' }, { status: 404 });
      }

      return NextResponse.json({ success: true, wallet });
    }

    if (!privileged) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لعرض محافظ المناديب' },
        { status: 403 }
      );
    }

    const [agents, balanceGroups, statsGroups] = await Promise.all([
      prisma.orderUser.findMany({
        where: {
          isActive: true,
          servicePermissions: {
            some: { serviceKey: 'my-deliveries' },
          },
        },
        select: {
          id: true,
          name: true,
          username: true,
          phone: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.deliveryAgentWalletTransaction.groupBy({
        by: ['deliveryAgentId'],
        _sum: { amount: true },
      }),
      prisma.deliveryAgentWalletTransaction.groupBy({
        by: ['deliveryAgentId', 'type'],
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const balanceMap = new Map(
      balanceGroups.map((group) => [group.deliveryAgentId, decimalToNumber(group._sum.amount)])
    );

    const groupedByAgent = new Map<
      string,
      {
        type: DeliveryAgentWalletTransactionType;
        _count: { _all: number };
        _sum: { amount: any };
      }[]
    >();

    for (const stat of statsGroups) {
      const current = groupedByAgent.get(stat.deliveryAgentId) || [];
      current.push(stat);
      groupedByAgent.set(stat.deliveryAgentId, current);
    }

    const wallets = agents.map((agent) => {
      const statsSummary = buildStats(groupedByAgent.get(agent.id) || []);

      return {
        agent,
        balance: balanceMap.get(agent.id) || 0,
        stats: statsSummary,
      };
    });

    const totalOutstanding = wallets.reduce((sum, wallet) => sum + Math.max(wallet.balance, 0), 0);
    const totalShipments = wallets.reduce((sum, wallet) => sum + wallet.stats.shipments.count, 0);
    const totalTasks = wallets.reduce((sum, wallet) => sum + wallet.stats.tasks.count, 0);
    const totalPayouts = wallets.reduce((sum, wallet) => sum + wallet.stats.payouts.count, 0);
    const totalPaidAmount = wallets.reduce(
      (sum, wallet) => sum + Math.abs(wallet.stats.payouts.total),
      0
    );

    return NextResponse.json({
      success: true,
      wallets,
      summary: {
        totalAgents: wallets.length,
        totalOutstanding,
        totalShipments,
        totalTasks,
        totalPayouts,
        totalPaidAmount,
        adminWalletBalance: totalOutstanding,
      },
    });
  } catch (error) {
    log.error('Error fetching delivery agent wallets', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب بيانات المحافظ' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    if (!hasPrivilegedAccess(user)) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لإضافة دفعات المحافظ' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { deliveryAgentId, amount, paymentMethod, notes } = body;

    if (!deliveryAgentId || amount === undefined) {
      return NextResponse.json({ error: 'المندوب والمبلغ مطلوبان' }, { status: 400 });
    }

    const payoutAmount = Number(amount);
    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      return NextResponse.json({ error: 'المبلغ يجب أن يكون رقماً أكبر من صفر' }, { status: 400 });
    }

    const agent = await prisma.orderUser.findFirst({
      where: {
        id: deliveryAgentId,
        servicePermissions: {
          some: { serviceKey: 'my-deliveries' },
        },
      },
      select: { id: true },
    });

    if (!agent) {
      return NextResponse.json({ error: 'المندوب غير موجود' }, { status: 404 });
    }

    const transaction = await recordDeliveryAgentWalletPayout({
      deliveryAgentId,
      amount: payoutAmount,
      paymentMethod,
      notes,
      createdById: user.id,
      createdByName: user.name || user.username,
    });

    log.info('Recorded delivery agent payout', {
      deliveryAgentId,
      amount: payoutAmount,
      createdBy: user.username,
    });

    return NextResponse.json({ success: true, transaction: formatTransaction(transaction) });
  } catch (error) {
    log.error('Error recording delivery agent payout', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تسجيل الدفعة' },
      { status: 500 }
    );
  }
}
