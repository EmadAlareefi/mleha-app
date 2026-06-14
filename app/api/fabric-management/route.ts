import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';

const FABRIC_SERVICE = 'fabric-management';
const YARD_TO_METER = 0.9144;

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

function lengthToMeters(value: unknown, unit: unknown, field: string) {
  const length = toPositiveDecimal(value, field);
  return unit === 'yard' ? length.mul(YARD_TO_METER) : length;
}

function costToPerMeter(value: unknown, unit: unknown) {
  const cost = toDecimal(value);
  if (unit === 'yard') {
    return cost.div(YARD_TO_METER);
  }
  return cost;
}

function getAuditUser(session: any) {
  return (
    session?.user?.username ||
    session?.user?.name ||
    session?.user?.email ||
    session?.user?.id ||
    'admin'
  );
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
    purchaseUnitCost: request.purchaseUnitCost === null || request.purchaseUnitCost === undefined
      ? null
      : toNumber(request.purchaseUnitCost),
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
          unitCost: costToPerMeter(body.unitCost, body.lengthUnit),
          stockLength: body.stockLength ? lengthToMeters(body.stockLength, body.lengthUnit, 'الطول في المخزون') : toDecimal(0),
          minStock: body.minStock ? lengthToMeters(body.minStock, body.lengthUnit, 'حد التنبيه') : toDecimal(0),
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

    if (action === 'add-fabric-stock') {
      const fabricId = String(body.fabricId || '');
      const purchasedLength = lengthToMeters(body.purchasedLength, body.lengthUnit, 'الكمية المضافة');

      if (!fabricId) {
        return NextResponse.json({ error: 'القماش مطلوب' }, { status: 400 });
      }

      const existingFabric = await prisma.fabric.findUnique({ where: { id: fabricId } });
      if (!existingFabric) {
        return NextResponse.json({ error: 'القماش غير موجود' }, { status: 404 });
      }

      const updatedFabric = await prisma.fabric.update({
        where: { id: fabricId },
        data: {
          stockLength: { increment: purchasedLength },
          supplier: body.supplier || existingFabric.supplier,
          unitCost:
            body.unitCost !== undefined && body.unitCost !== ''
              ? costToPerMeter(body.unitCost, body.lengthUnit)
              : existingFabric.unitCost,
          notes: body.notes
            ? [existingFabric.notes, `توريد جديد: ${body.notes}`].filter(Boolean).join('\n')
            : existingFabric.notes,
        },
      });

      return NextResponse.json(serializeFabric(updatedFabric));
    }

    if (action === 'issue-fabric') {
      const fabricId = String(body.fabricId || '');
      const tailorId = String(body.tailorId || '');
      const issuedLength = lengthToMeters(body.issuedLength, body.lengthUnit, 'الكمية المسلمة');

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
      const consumedLength = body.consumedLength
        ? lengthToMeters(body.consumedLength, body.lengthUnit, 'المستهلك من القماش')
        : toDecimal(0);
      const returnedLength = body.returnedLength
        ? lengthToMeters(body.returnedLength, body.lengthUnit, 'المرتجع للمخزون')
        : toDecimal(0);

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

      const updatedRequest = await prisma.$transaction(async (tx) => {
        const existingRequest = await tx.tailorFabricRequest.findUnique({
          where: { id: requestId },
          include: { fabric: true, tailor: true },
        });
        if (!existingRequest) throw new Error('طلب القماش غير موجود');

        let fabricId = existingRequest.fabricId;
        const isPurchaseApproval =
          existingRequest.requestType === 'purchase' &&
          status === 'approved' &&
          !['approved', 'fulfilled'].includes(existingRequest.status);

        if (isPurchaseApproval) {
          const purchaseName = existingRequest.purchaseName?.trim();
          if (!purchaseName) throw new Error('اسم القماش المشترى مطلوب قبل الاعتماد');

          const purchaseSku = existingRequest.purchaseSku?.trim() || null;
          const matchingFabric = fabricId
            ? existingRequest.fabric
            : purchaseSku
              ? await tx.fabric.findUnique({ where: { sku: purchaseSku } })
              : null;

          const stockLength = existingRequest.requestedLength;
          const unitCost = existingRequest.purchaseUnitCost || new Prisma.Decimal(0);

          if (matchingFabric) {
            const notes = [
              matchingFabric.notes,
              `شراء معتمد من ${existingRequest.tailor.name}: ${existingRequest.notes || ''}`.trim(),
            ]
              .filter(Boolean)
              .join('\n');

            const updatedFabric = await tx.fabric.update({
              where: { id: matchingFabric.id },
              data: {
                stockLength: { increment: stockLength },
                unitCost,
                color: existingRequest.purchaseColor || matchingFabric.color,
                fabricType: existingRequest.purchaseFabricType || matchingFabric.fabricType,
                supplier: existingRequest.purchaseSupplier || matchingFabric.supplier,
                notes,
              },
            });
            fabricId = updatedFabric.id;
          } else {
            const createdFabric = await tx.fabric.create({
              data: {
                name: purchaseName,
                sku: purchaseSku,
                color: existingRequest.purchaseColor || null,
                fabricType: existingRequest.purchaseFabricType || null,
                supplier: existingRequest.purchaseSupplier || null,
                unitCost,
                stockLength,
                notes: existingRequest.notes || null,
              },
            });
            fabricId = createdFabric.id;
          }
        }

        return tx.tailorFabricRequest.update({
          where: { id: requestId },
          data: {
            fabricId,
            status,
            fulfilledAt: status === 'fulfilled' ? new Date() : existingRequest.fulfilledAt,
            approvedAt: status === 'approved' ? new Date() : existingRequest.approvedAt,
            approvedBy: status === 'approved' ? getAuditUser(access.session) : existingRequest.approvedBy,
          },
          include: { fabric: true, tailor: true },
        });
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
