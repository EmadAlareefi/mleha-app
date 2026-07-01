import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const SEQUENCE_DIGITS = 3;
const MAX_SEQUENCE = 10 ** SEQUENCE_DIGITS - 1;
const SKU_TIME_ZONE = 'Asia/Riyadh';

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

function getSessionUsername(session: any) {
  return String(session?.user?.username || session?.user?.id || '').trim();
}

export function getDesignModelSkuPrefix(session: any, date = new Date()) {
  const username = getSessionUsername(session);
  if (!username) {
    throw new Error('لا يمكن إنشاء SKU بدون اسم مستخدم صالح');
  }

  const year = new Intl.DateTimeFormat('en-US', {
    year: '2-digit',
    timeZone: SKU_TIME_ZONE,
  }).format(date);
  return `${username}${year}`;
}

export async function allocateDesignModelSku(client: PrismaClientLike, session: any, date = new Date()) {
  const prefix = getDesignModelSkuPrefix(session, date);
  const models = await client.designModel.findMany({
    where: { sku: { startsWith: prefix } },
    select: { sku: true },
  });

  const maxSequence = models.reduce((max, model) => {
    const suffix = model.sku.slice(prefix.length);
    return /^\d{3}$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);

  if (maxSequence >= MAX_SEQUENCE) {
    throw new Error(`تم استهلاك كل تسلسل SKU للبادئة ${prefix}`);
  }

  return `${prefix}${String(maxSequence + 1).padStart(SEQUENCE_DIGITS, '0')}`;
}
