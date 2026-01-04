import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseSettlementFile, SettlementProvider, ParsedSettlementRecord } from '@/app/lib/settlements/parsers';
import { createHash } from 'crypto';

function hasAccountingAccess(session: any): boolean {
  const role = session?.user?.role;
  const roles: string[] = session?.user?.roles || (role ? [role] : []);
  return roles.includes('admin') || roles.includes('accountant');
}

function isAdmin(session: any): boolean {
  const role = session?.user?.role;
  const roles: string[] = session?.user?.roles || (role ? [role] : []);
  return roles.includes('admin');
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    if (!hasAccountingAccess(session)) {
      return NextResponse.json({ error: 'لا تملك صلاحية للوصول' }, { status: 403 });
    }

    const [uploads, totalRecords, linkedRecords, providerBreakdown, recentSettlements, unmatchedSamples] =
      await Promise.all([
        prisma.settlementUpload.findMany({
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            provider: true,
            statementDate: true,
            originalFileName: true,
            fileSize: true,
            uploadedByName: true,
            status: true,
            recordCount: true,
            matchedCount: true,
            unmatchedCount: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.orderSettlement.count(),
        prisma.orderSettlement.count({
          where: { linkedOrderId: { not: null } },
        }),
        prisma.orderSettlement.groupBy({
          by: ['provider'],
          _count: { _all: true },
        }),
        prisma.orderSettlement.findMany({
          orderBy: { updatedAt: 'desc' },
          take: 15,
          select: {
            id: true,
            provider: true,
            orderId: true,
            orderNumber: true,
            settlementDate: true,
            netAmount: true,
            currency: true,
            paymentMethod: true,
            eventType: true,
            linkedOrderId: true,
            createdAt: true,
          },
        }),
        prisma.orderSettlement.findMany({
          where: { linkedOrderId: null },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            provider: true,
            orderId: true,
            orderNumber: true,
            awbNumber: true,
            settlementDate: true,
            netAmount: true,
          },
        }),
      ]);

    const serializedRecent = recentSettlements.map((record) => ({
      ...record,
      netAmount: record.netAmount ? Number(record.netAmount) : null,
    }));

    const serializedUnmatched = unmatchedSamples.map((record) => ({
      ...record,
      netAmount: record.netAmount ? Number(record.netAmount) : null,
    }));

    return NextResponse.json({
      uploads,
      stats: {
        totalRecords,
        linkedRecords,
        unmatchedRecords: totalRecords - linkedRecords,
        providerBreakdown,
      },
      recentSettlements: serializedRecent,
      unmatchedSamples: serializedUnmatched,
    });
  } catch (error) {
    console.error('Failed to load settlements overview', error);
    return NextResponse.json({ error: 'فشل في تحميل البيانات' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!hasAccountingAccess(session)) {
    return NextResponse.json({ error: 'لا تملك صلاحية لرفع الملفات' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const provider = formData.get('provider')?.toString().toLowerCase() as SettlementProvider;
    const statementDateValue = formData.get('statementDate')?.toString();
    const parsedStatementDate = statementDateValue ? new Date(statementDateValue) : undefined;
    const statementDate =
      parsedStatementDate && !Number.isNaN(parsedStatementDate.getTime())
        ? parsedStatementDate
        : undefined;
    const notes = formData.get('notes')?.toString();
    const files = formData
      .getAll('files')
      .filter((file): file is File => file instanceof File);

    if (!provider) {
      return NextResponse.json({ error: 'يجب اختيار مزود التسوية' }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'يرجى اختيار ملف واحد على الأقل' }, { status: 400 });
    }

    const uploadResults = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parseResult = parseSettlementFile(provider, buffer, { statementDate });
      const { records, warnings } = parseResult;

      const upload = await prisma.settlementUpload.create({
        data: {
          provider,
          statementDate: statementDate || null,
          originalFileName: file.name,
          fileSize: file.size,
          contentType: file.type || 'application/octet-stream',
          uploadedById: (session.user as any)?.id || null,
          uploadedByName: (session.user as any)?.name || (session.user as any)?.username || null,
          status: 'processing',
          recordCount: records.length,
          notes,
          fileData: buffer,
        },
      });

      if (records.length === 0) {
        await prisma.settlementUpload.update({
          where: { id: upload.id },
          data: {
            status: 'completed',
            matchedCount: 0,
            unmatchedCount: 0,
            errorMessage: warnings.join(', ') || 'لم يتم العثور على أي سجلات في الملف',
          },
        });

        uploadResults.push({
          uploadId: upload.id,
          fileName: file.name,
          message: 'لم يتم العثور على أي سجلات في الملف',
          matchedCount: 0,
          totalRecords: 0,
          warnings,
        });

        continue;
      }

      const { matchedCount, unmatchedCount, unmatchedSamples } = await persistSettlementRecords(
        provider,
        records,
        upload.id
      );

      await prisma.settlementUpload.update({
        where: { id: upload.id },
        data: {
          status: 'completed',
          matchedCount,
          unmatchedCount,
        },
      });

      uploadResults.push({
        uploadId: upload.id,
        fileName: file.name,
        matchedCount,
        unmatchedCount,
        totalRecords: records.length,
        warnings,
        unmatchedSamples,
      });
    }

    return NextResponse.json({ uploads: uploadResults });
  } catch (error) {
    console.error('Failed to upload settlements', error);
    return NextResponse.json({ error: 'فشل في معالجة الملف' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'فقط المدير يمكنه حذف الملفات' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let uploadId = searchParams.get('id');

    if (!uploadId) {
      try {
        const body = await request.json();
        uploadId = body?.id;
      } catch {
        // ignore JSON parse errors since id might be provided via query param
      }
    }

    if (!uploadId) {
      return NextResponse.json({ error: 'يجب تحديد معرف الملف' }, { status: 400 });
    }

    const existingUpload = await prisma.settlementUpload.findUnique({
      where: { id: uploadId },
      select: { id: true },
    });

    if (!existingUpload) {
      return NextResponse.json({ error: 'الملف غير موجود' }, { status: 404 });
    }

    const [deletedSettlements] = await prisma.$transaction([
      prisma.orderSettlement.deleteMany({
        where: { uploadId },
      }),
      prisma.settlementUpload.delete({
        where: { id: uploadId },
      }),
    ]);

    return NextResponse.json({
      success: true,
      deletedSettlements: deletedSettlements.count,
    });
  } catch (error) {
    console.error('Failed to delete settlement upload', error);
    return NextResponse.json({ error: 'فشل في حذف الملف' }, { status: 500 });
  }
}

async function persistSettlementRecords(
  provider: SettlementProvider,
  records: ParsedSettlementRecord[],
  uploadId: string
) {
  const orderIds = Array.from(
    new Set(
      records
        .map((record) => record.orderId)
        .filter((value): value is string => !!value)
    )
  );
  const orderNumbers = Array.from(
    new Set(
      records
        .map((record) => record.orderNumber)
        .filter((value): value is string => !!value)
    )
  );
  const referenceIds = Array.from(
    new Set(
      records
        .map((record) => record.orderNumber)
        .filter((value): value is string => !!value)
    )
  );
  const awbNumbers = Array.from(
    new Set(
      records
        .map((record) => record.awbNumber)
        .filter((value): value is string => !!value)
    )
  );

  type OrderSummary = { id: string; orderId: string; orderNumber: string | null; referenceId: string | null; merchantId: string };
  const ordersById = new Map<string, OrderSummary>();
  const ordersByNumber = new Map<string, OrderSummary>();
  const ordersByReferenceId = new Map<string, OrderSummary>();
  const selectedFields = { id: true, orderId: true, orderNumber: true, referenceId: true, merchantId: true };

  const cacheOrder = (order: OrderSummary) => {
    ordersById.set(order.orderId, order);
    if (order.orderNumber) {
      ordersByNumber.set(order.orderNumber, order);
    }
    if (order.referenceId) {
      ordersByReferenceId.set(order.referenceId, order);
    }
  };

  if (orderIds.length) {
    const fetchedOrders = await prisma.sallaOrder.findMany({
      where: { orderId: { in: orderIds } },
      select: selectedFields,
    });
    fetchedOrders.forEach(cacheOrder);
  }

  if (orderNumbers.length) {
    const fetchedOrders = await prisma.sallaOrder.findMany({
      where: { orderNumber: { in: orderNumbers } },
      select: selectedFields,
    });
    fetchedOrders.forEach(cacheOrder);
  }

  if (referenceIds.length) {
    const fetchedOrders = await prisma.sallaOrder.findMany({
      where: { referenceId: { in: referenceIds } },
      select: selectedFields,
    });
    fetchedOrders.forEach(cacheOrder);
  }

  const shipmentOrderMap = new Map<string, string>();
  if (awbNumbers.length) {
    const shipments = await prisma.sallaShipment.findMany({
      where: {
        OR: [
          { trackingNumber: { in: awbNumbers } },
          { awbNumber: { in: awbNumbers } },
          { sawb: { in: awbNumbers } },
        ],
      },
      select: { orderId: true, trackingNumber: true, awbNumber: true, sawb: true },
    });

    shipments.forEach((shipment) => {
      [shipment.trackingNumber, shipment.awbNumber, shipment.sawb]
        .filter((code): code is string => !!code)
        .forEach((code) => shipmentOrderMap.set(code, shipment.orderId));
    });

    const shipmentOrderIds = shipments
      .map((shipment) => shipment.orderId)
      .filter((value): value is string => !!value && !ordersById.has(value));

    if (shipmentOrderIds.length) {
      const fetchedOrders = await prisma.sallaOrder.findMany({
        where: { orderId: { in: shipmentOrderIds } },
        select: selectedFields,
      });
      fetchedOrders.forEach(cacheOrder);
    }
  }

  let matchedCount = 0;
  const unmatchedSamples: { orderId?: string; orderNumber?: string; awbNumber?: string }[] = [];

  for (const [index, record] of records.entries()) {
    const mappedOrderId = record.awbNumber ? shipmentOrderMap.get(record.awbNumber) : undefined;
    const matchedOrder =
      (record.orderId && ordersById.get(record.orderId)) ||
      (record.orderNumber && (ordersByNumber.get(record.orderNumber) || ordersByReferenceId.get(record.orderNumber))) ||
      (mappedOrderId && ordersById.get(mappedOrderId));

    if (matchedOrder) {
      matchedCount += 1;
    } else if (unmatchedSamples.length < 5) {
      unmatchedSamples.push({
        orderId: record.orderId,
        orderNumber: record.orderNumber,
        awbNumber: record.awbNumber,
      });
    }

    const sourceHash = createHash('sha256')
      .update(`${provider}|${JSON.stringify(record.raw || record)}`)
      .digest('hex');

    const payload = {
      uploadId,
      provider,
      merchantId: matchedOrder?.merchantId || record.merchantId || null,
      orderId: record.orderId || matchedOrder?.orderId || null,
      orderNumber: record.orderNumber || matchedOrder?.orderNumber || null,
      awbNumber: record.awbNumber || null,
      paymentMethod: record.paymentMethod || null,
      eventType: record.eventType || null,
      settlementDate: record.settlementDate || null,
      grossAmount: record.grossAmount ?? null,
      feeAmount: record.feeAmount ?? null,
      taxAmount: record.taxAmount ?? null,
      netAmount: record.netAmount ?? null,
      currency: record.currency || 'SAR',
      sourceReference:
        record.sourceReference ||
        [record.orderId, record.orderNumber, record.awbNumber, record.eventType, record.netAmount]
          .filter(Boolean)
          .join('-') ||
        `${provider}-${index}`,
      sourceHash,
      rawData: record.raw,
      linkedOrderId: matchedOrder?.id || null,
    };

    await prisma.orderSettlement.upsert({
      where: { sourceHash },
      update: payload,
      create: payload,
    });
  }

  return {
    matchedCount,
    unmatchedCount: records.length - matchedCount,
    unmatchedSamples,
  };
}
