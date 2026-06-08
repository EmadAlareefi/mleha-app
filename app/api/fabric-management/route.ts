import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';

const FABRIC_SERVICE = 'fabric-management';

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toPositiveDecimal(value: unknown, field: string) {
  const numberValue = toNumber(value, NaN);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${field} يجب أن يكون أكبر من صفر`);
  }
  return new Prisma.Decimal(numberValue);
}

function toDecimal(value: unknown, fallback = 0) {
  return new Prisma.Decimal(toNumber(value, fallback));
}

function serializeIssue(issue: any) {
  const issued = toNumber(issue.issuedLength);
  const consumed = toNumber(issue.consumedLength);
  const returned = toNumber(issue.returnedLength);
  const unitCost = toNumber(issue.unitCostAtIssue);
  const tailoringCost = toNumber(issue.tailoringCost);
  const extraCost = toNumber(issue.extraCost);
  const dressCount = Number(issue.deliveredDressCount || 0);
  const remainingAtTailor = Math.max(issued - consumed - returned, 0);
  const totalDressCost = consumed * unitCost + tailoringCost + extraCost;

  return {
    ...issue,
    issuedLength: issued,
    unitCostAtIssue: unitCost,
    consumedLength: consumed,
    returnedLength: returned,
    tailoringCost,
    extraCost,
    remainingAtTailor,
    totalDressCost,
    costPerDress: dressCount > 0 ? totalDressCost / dressCount : null,
    fabric: issue.fabric
      ? {
          ...issue.fabric,
          unitCost: toNumber(issue.fabric.unitCost),
          stockLength: toNumber(issue.fabric.stockLength),
          minStock: toNumber(issue.fabric.minStock),
        }
      : undefined,
  };
}

function serializeFabric(fabric: any) {
  const stockLength = toNumber(fabric.stockLength);
  const minStock = toNumber(fabric.minStock);
  return {
    ...fabric,
    unitCost: toNumber(fabric.unitCost),
    stockLength,
    minStock,
    isLowStock: stockLength <= minStock,
  };
}

function serializeRequest(request: any) {
  return {
    ...request,
    requestedLength: toNumber(request.requestedLength),
    fabric: request.fabric ? serializeFabric(request.fabric) : undefined,
  };
}

async function requireAccess() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى إدارة الأقمشة' },
        { status: 401 }
      ),
    };
  }

  if (!hasServiceAccess(session, FABRIC_SERVICE)) {
    return {
      error: NextResponse.json(
        { error: 'لا تملك صلاحية لإدارة الأقمشة' },
        { status: 403 }
      ),
    };
  }

  return { session };
}

export async function GET() {
  try {
    const access = await requireAccess();
    if (access.error) return access.error;

    const [fabrics, tailors, issues, requests] = await Promise.all([
      prisma.fabric.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      prisma.tailor.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      prisma.tailorFabricIssue.findMany({
        include: { fabric: true, tailor: true },
        orderBy: { issueDate: 'desc' },
        take: 100,
      }),
      prisma.tailorFabricRequest.findMany({
        include: { fabric: true, tailor: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const serializedIssues = issues.map(serializeIssue);
    const stockMeters = fabrics.reduce((sum, fabric) => sum + toNumber(fabric.stockLength), 0);
    const withTailorsMeters = serializedIssues
      .filter((issue) => issue.status !== 'closed')
      .reduce((sum, issue) => sum + issue.remainingAtTailor, 0);

    return NextResponse.json({
      fabrics: fabrics.map(serializeFabric),
      tailors,
      issues: serializedIssues,
      requests: requests.map(serializeRequest),
      summary: {
        fabricsCount: fabrics.length,
        activeTailorsCount: tailors.filter((tailor) => tailor.isActive).length,
        stockMeters,
        withTailorsMeters,
        pendingRequestsCount: requests.filter((request) => request.status === 'pending').length,
      },
    });
  } catch (error) {
    console.error('Error fetching fabric management data:', error);
    return NextResponse.json({ error: 'فشل في جلب بيانات الأقمشة' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAccess();
    if (access.error) return access.error;

    const body = await request.json();
    const action = body.action;

    if (action === 'create-fabric') {
      if (!body.name) {
        return NextResponse.json({ error: 'اسم القماش مطلوب' }, { status: 400 });
      }

      const fabric = await prisma.fabric.create({
        data: {
          name: body.name,
          sku: body.sku || null,
          color: body.color || null,
          fabricType: body.fabricType || null,
          supplier: body.supplier || null,
          unitCost: toDecimal(body.unitCost),
          stockLength: toDecimal(body.stockLength),
          minStock: toDecimal(body.minStock),
          notes: body.notes || null,
        },
      });

      return NextResponse.json(serializeFabric(fabric), { status: 201 });
    }

    if (action === 'create-tailor') {
      if (!body.name || !body.accessCode) {
        return NextResponse.json({ error: 'اسم الخياط ورمز الدخول مطلوبان' }, { status: 400 });
      }

      const tailor = await prisma.tailor.create({
        data: {
          name: body.name,
          workshopName: body.workshopName || null,
          phone: body.phone || null,
          accessCode: body.accessCode,
          notes: body.notes || null,
        },
      });

      return NextResponse.json(tailor, { status: 201 });
    }

    if (action === 'issue-fabric') {
      const fabricId = String(body.fabricId || '');
      const tailorId = String(body.tailorId || '');
      const issuedLength = toPositiveDecimal(body.issuedLength, 'الكمية المسلمة');

      if (!fabricId || !tailorId) {
        return NextResponse.json({ error: 'القماش والخياط مطلوبان' }, { status: 400 });
      }

      const issue = await prisma.$transaction(async (tx) => {
        const fabric = await tx.fabric.findUnique({ where: { id: fabricId } });
        if (!fabric) throw new Error('القماش غير موجود');
        if (fabric.stockLength.lessThan(issuedLength)) {
          throw new Error('كمية القماش في المخزون غير كافية');
        }

        await tx.fabric.update({
          where: { id: fabricId },
          data: { stockLength: { decrement: issuedLength } },
        });

        return tx.tailorFabricIssue.create({
          data: {
            fabricId,
            tailorId,
            issuedLength,
            unitCostAtIssue: fabric.unitCost,
            issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
            reference: body.reference || null,
            notes: body.notes || null,
          },
          include: { fabric: true, tailor: true },
        });
      });

      return NextResponse.json(serializeIssue(issue), { status: 201 });
    }

    if (action === 'record-delivery') {
      const issueId = String(body.issueId || '');
      if (!issueId) {
        return NextResponse.json({ error: 'عملية التسليم مطلوبة' }, { status: 400 });
      }

      const deliveredDressCount = Math.max(0, Math.trunc(toNumber(body.deliveredDressCount)));
      const consumedLength = toDecimal(body.consumedLength);
      const returnedLength = toDecimal(body.returnedLength);

      const issue = await prisma.$transaction(async (tx) => {
        const existing = await tx.tailorFabricIssue.findUnique({ where: { id: issueId } });
        if (!existing) throw new Error('سجل القماش المسلم غير موجود');

        const totalUsed = consumedLength.plus(returnedLength);
        if (totalUsed.greaterThan(existing.issuedLength)) {
          throw new Error('المستهلك والمرتجع لا يمكن أن يتجاوزا الكمية المسلمة');
        }

        const previousReturned = existing.returnedLength || new Prisma.Decimal(0);
        const returnedDelta = returnedLength.minus(previousReturned);
        if (!returnedDelta.equals(0)) {
          await tx.fabric.update({
            where: { id: existing.fabricId },
            data: { stockLength: { increment: returnedDelta } },
          });
        }

        return tx.tailorFabricIssue.update({
          where: { id: issueId },
          data: {
            deliveredDressCount,
            consumedLength,
            returnedLength,
            tailoringCost: toDecimal(body.tailoringCost),
            extraCost: toDecimal(body.extraCost),
            deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : new Date(),
            status: body.status || 'delivered',
            notes: body.notes || existing.notes,
          },
          include: { fabric: true, tailor: true },
        });
      });

      return NextResponse.json(serializeIssue(issue));
    }

    if (action === 'update-request-status') {
      const requestId = String(body.requestId || '');
      const status = String(body.status || '');
      if (!requestId || !['pending', 'approved', 'fulfilled', 'rejected'].includes(status)) {
        return NextResponse.json({ error: 'حالة الطلب غير صالحة' }, { status: 400 });
      }

      const updatedRequest = await prisma.tailorFabricRequest.update({
        where: { id: requestId },
        data: {
          status,
          fulfilledAt: status === 'fulfilled' ? new Date() : null,
        },
        include: { fabric: true, tailor: true },
      });

      return NextResponse.json(serializeRequest(updatedRequest));
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error: any) {
    console.error('Error saving fabric management data:', error);
    return NextResponse.json(
      { error: error.message || 'فشل في حفظ بيانات الأقمشة' },
      { status: 500 }
    );
  }
}
