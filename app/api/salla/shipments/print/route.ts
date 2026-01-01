import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { sendPrintJob } from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

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

    const body = await request.json();
    const { assignmentId } = body;

    if (!assignmentId) {
      return NextResponse.json({ success: false, error: 'معرف الطلب مطلوب' }, { status: 400 });
    }

    const assignment = await prisma.orderAssignment.findUnique({
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

    const shipment = await prisma.sallaShipment.findFirst({
      where: {
        merchantId: assignment.merchantId,
        OR: [
          { orderId: assignment.orderId },
          { orderNumber: assignment.orderNumber },
          { orderNumber: assignment.orderId },
        ],
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

    log.info('Sending manual print job for shipment', {
      assignmentId,
      orderId: assignment.orderId,
      merchantId: assignment.merchantId,
      requestedBy: user.username || user.id,
      forceReprint: alreadyPrinted && isAdmin,
    });

    const printResult = await sendPrintJob({
      title: `Manual Shipment Label - Order ${assignment.orderNumber || assignment.orderId}`,
      contentType: 'pdf_uri',
      content: labelUrl,
      copies: 1,
    });

    if (!printResult.success) {
      log.error('PrintNode API error while sending manual print job', {
        assignmentId,
        orderId: assignment.orderId,
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
      assignmentId,
      orderId: assignment.orderId,
      jobId: printResult.jobId,
      printCount: updatedShipment.printCount,
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
