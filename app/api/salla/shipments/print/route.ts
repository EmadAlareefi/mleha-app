import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { sendPrintJob, PRINTNODE_LABEL_PAPER_NAME, PRINTNODE_DEFAULT_DPI } from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';
import { printCommercialInvoiceIfInternational } from '@/app/lib/international-printing';

export const runtime = 'nodejs';

const SHIPPING_PRINTER_OVERRIDES: Record<string, number> = {
  '1': 75006700,
  '15': 75062490,
};

const getUserRoles = (sessionUser: any): string[] => {
  if (!sessionUser) return [];
  if (Array.isArray(sessionUser.roles)) {
    return sessionUser.roles.filter(Boolean);
  }
  if (sessionUser.role) {
    return [sessionUser.role];
  }
  return [];
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'غير مصرح لك' }, { status: 401 });
    }

    const user = session.user as any;
    const roles = getUserRoles(user);
    const isAdmin = roles.includes('admin');
    const isOrdersUser = roles.includes('orders');

    if (!isAdmin && !isOrdersUser) {
      return NextResponse.json({ success: false, error: 'لا تملك صلاحية طباعة الشحنات' }, { status: 403 });
    }

    let printerLink: {
      printerId: number;
      printerName: string | null;
      paperName: string | null;
    } | null = null;

    if (user?.id) {
      try {
        printerLink = await prisma.orderUserPrinterLink.findUnique({
          where: { userId: user.id },
          select: {
            printerId: true,
            printerName: true,
            paperName: true,
          },
        });
      } catch (dbError) {
        log.warn('Unable to load printer link for user, falling back to overrides', {
          userId: user.id,
          error: dbError instanceof Error ? dbError.message : dbError,
        });
      }
    }

    const body = await request.json();
    const {
      assignmentId,
      orderId: providedOrderId,
      orderNumber: providedOrderNumber,
    } = body;

    if (!assignmentId && !providedOrderId && !providedOrderNumber) {
      return NextResponse.json({ success: false, error: 'معرف الطلب أو رقم الطلب مطلوب' }, { status: 400 });
    }

    let assignment: {
      id: string;
      userId: string;
      merchantId: string;
      orderId: string;
      orderNumber: string;
    } | null = null;
    let merchantIdForShipment: string | null = null;
    let resolvedOrderId: string | null = providedOrderId || null;
    let resolvedOrderNumber: string | null = providedOrderNumber || null;

    if (assignmentId) {
      assignment = await prisma.orderAssignment.findUnique({
        where: { id: assignmentId },
      });

      if (!assignment) {
        return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
      }

      if (!isAdmin && assignment.userId !== user.id) {
        return NextResponse.json(
          { success: false, error: 'لا يمكنك طباعة بوليصة لطلب غير مكلف به' },
          { status: 403 }
        );
      }

      merchantIdForShipment = assignment.merchantId;
      resolvedOrderId = assignment.orderId;
      resolvedOrderNumber = assignment.orderNumber;
    } else if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'لا يمكنك طباعة بوليصة لطلب غير مكلف به' },
        { status: 403 }
      );
    }

    if (!resolvedOrderId && !resolvedOrderNumber) {
      return NextResponse.json(
        { success: false, error: 'بيانات الطلب غير مكتملة للطباعة' },
        { status: 400 }
      );
    }

    const shipmentFilters: any[] = [];

    if (resolvedOrderId) {
      shipmentFilters.push({ orderId: resolvedOrderId }, { orderNumber: resolvedOrderId });
    }

    if (resolvedOrderNumber) {
      shipmentFilters.push({ orderNumber: resolvedOrderNumber }, { orderId: resolvedOrderNumber });
    }

    const shipment = await prisma.sallaShipment.findFirst({
      where: {
        ...(merchantIdForShipment ? { merchantId: merchantIdForShipment } : {}),
        OR: shipmentFilters,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!shipment) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على شحنة لهذا الطلب' },
        { status: 404 }
      );
    }

    const shipmentData = shipment.shipmentData as any;
    const labelUrl =
      shipment.labelUrl ||
      shipmentData?.label_url ||
      shipmentData?.label?.url ||
      (typeof shipmentData?.label === 'string' ? shipmentData.label : null);

    if (!labelUrl) {
      return NextResponse.json(
        { success: false, error: 'لا يوجد رابط بوليصة للطباعة' },
        { status: 400 }
      );
    }

    const alreadyPrinted = shipment.labelPrinted || (shipment.printCount ?? 0) > 0;

    if (alreadyPrinted && !isAdmin) {
      return NextResponse.json(
        { success: false, error: 'تمت طباعة هذه البوليصة سابقاً. اطلب من الإدارة إعادة الطباعة.' },
        { status: 403 }
      );
    }

    const targetOrderNumber =
      assignment?.orderNumber || shipment.orderNumber || resolvedOrderNumber || resolvedOrderId || 'غير معروف';
    const targetOrderId = assignment?.orderId || shipment.orderId || resolvedOrderId || 'غير معروف';
    const fallbackPrinterId =
      typeof user.username === 'string' ? SHIPPING_PRINTER_OVERRIDES[user.username] : undefined;
    const targetPrinterId = printerLink?.printerId ?? fallbackPrinterId;
    const printerPaperName = printerLink?.paperName || PRINTNODE_LABEL_PAPER_NAME;

    log.info('Sending manual print job for shipment', {
      assignmentId: assignment?.id || assignmentId || null,
      orderId: targetOrderId,
      merchantId: merchantIdForShipment || shipment.merchantId,
      requestedBy: user.username || user.id,
      forceReprint: alreadyPrinted && isAdmin,
      trigger: assignment ? 'assignment' : 'admin-search',
      printerId: targetPrinterId ?? 'default',
      printerSelection: printerLink?.printerId ? 'user-link' : fallbackPrinterId ? 'username-override' : 'default',
    });

    const printResult = await sendPrintJob({
      title: `Manual Shipment Label - Order ${targetOrderNumber}`,
      contentType: 'pdf_uri',
      content: labelUrl,
      copies: 1,
      paperName: printerPaperName,
      printerId: targetPrinterId,
      fitToPage: false,
      dpi: PRINTNODE_DEFAULT_DPI,
      rotate: 0,
    });

    if (!printResult.success) {
      log.error('PrintNode API error while sending manual print job', {
        assignmentId: assignment?.id || assignmentId || null,
        orderId: targetOrderId,
        error: printResult.error,
      });

      return NextResponse.json(
        { success: false, error: printResult.error || 'فشل إرسال البوليصة إلى الطابعة' },
        { status: 502 }
      );
    }

    const updatedShipment = await prisma.sallaShipment.update({
      where: { id: shipment.id },
      data: {
        labelUrl,
        labelPrinted: true,
        labelPrintedAt: new Date(),
        labelPrintedBy: user.id || 'system',
        labelPrintedByName: user.name || user.username || 'مشغل النظام',
        printJobId: printResult.jobId ? String(printResult.jobId) : shipment.printJobId,
        printCount: (shipment.printCount ?? 0) + 1,
      },
    });

    log.info('Manual print job sent successfully', {
      assignmentId: assignment?.id || assignmentId || null,
      orderId: targetOrderId,
      jobId: printResult.jobId,
      printCount: updatedShipment.printCount,
    });

    await printCommercialInvoiceIfInternational({
      orderId: targetOrderId,
      orderNumber: targetOrderNumber,
      merchantId: merchantIdForShipment || shipment.merchantId,
      assignmentId: assignment?.id || assignmentId || null,
      triggeredBy: user.username || user.id,
      source: 'manual-print',
    });

    return NextResponse.json({
      success: true,
      message: alreadyPrinted ? 'تمت إعادة إرسال البوليصة للطابعة' : 'تم إرسال البوليصة للطابعة',
      data: {
        labelUrl,
        labelPrintedAt: updatedShipment.labelPrintedAt?.toISOString() || null,
        labelPrinted: updatedShipment.labelPrinted,
        printCount: updatedShipment.printCount,
        printJobId: updatedShipment.printJobId,
      },
    });
  } catch (error) {
    log.error('Unhandled error while sending manual shipment print request', {
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء إرسال البوليصة للطابعة' },
      { status: 500 }
    );
  }
}
