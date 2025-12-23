import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { Prisma } from '@prisma/client';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const roles = user.roles || [user.role];

    // Check if user is admin or warehouse
    const isAuthorized = roles.includes('admin') || roles.includes('warehouse');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'غير مصرح للوصول' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('query') || searchParams.get('orderNumber');

    if (!rawQuery || !rawQuery.trim()) {
      return NextResponse.json({ error: 'يرجى إدخال رقم الطلب أو بيانات البحث' }, { status: 400 });
    }

    const searchQuery = rawQuery.trim();
    const digitsOnlyQuery = searchQuery.replace(/[^0-9]/g, '');

    const normalizedQueryVariants = new Set<string>();
    const addVariant = (value?: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      normalizedQueryVariants.add(trimmed);
    };

    addVariant(searchQuery);
    addVariant(searchQuery.toLowerCase());
    addVariant(searchQuery.toUpperCase());
    if (digitsOnlyQuery) {
      addVariant(digitsOnlyQuery);
      const noLeadingZeros = digitsOnlyQuery.replace(/^0+/, '');
      if (noLeadingZeros && noLeadingZeros !== digitsOnlyQuery) {
        addVariant(noLeadingZeros);
      }
      addVariant(`#${digitsOnlyQuery}`);
    }

    const phoneVariants = new Set<string>();
    if (digitsOnlyQuery) {
      phoneVariants.add(digitsOnlyQuery);
      const withoutCountryCode = digitsOnlyQuery.startsWith('966') ? digitsOnlyQuery.slice(3) : digitsOnlyQuery;
      phoneVariants.add(withoutCountryCode);
      if (!withoutCountryCode.startsWith('0')) {
        phoneVariants.add(`0${withoutCountryCode}`);
      }
      phoneVariants.add(`+${digitsOnlyQuery}`);
    }
    phoneVariants.add(searchQuery);

    const referencePaths = [
      ['reference_id'],
      ['referenceId'],
      ['reference'],
      ['reference_code'],
      ['referenceCode'],
      ['reference_number'],
      ['referenceNumber'],
      ['order_number'],
      ['orderNumber'],
      ['order_no'],
      ['orderNo'],
    ];

    const phonePaths = [
      ['customer', 'mobile'],
      ['customer', 'phone'],
      ['customer', 'mobile_code'],
      ['customer', 'mobileNumber'],
      ['customer', 'contact'],
      ['shipping_address', 'mobile'],
      ['shipping_address', 'phone'],
      ['billing_address', 'mobile'],
      ['billing_address', 'phone'],
    ];

    const customerIdPaths = [
      ['customer', 'id'],
      ['customer_id'],
      ['customerId'],
      ['customer_number'],
      ['customerNumber'],
    ];

    const sallaFilters: Prisma.SallaOrderWhereInput[] = [];

    const filters: Prisma.OrderAssignmentWhereInput[] = [
      { orderNumber: searchQuery },
      { orderId: searchQuery },
    ];

    normalizedQueryVariants.forEach((variant) => {
      filters.push(
        { orderNumber: variant },
        { orderNumber: { contains: variant, mode: 'insensitive' } },
        { orderId: variant },
        { orderId: { contains: variant, mode: 'insensitive' } },
      );

      sallaFilters.push(
        { orderNumber: variant },
        { orderNumber: { contains: variant, mode: 'insensitive' } },
        { referenceId: variant },
        { referenceId: { contains: variant, mode: 'insensitive' } },
        { orderId: variant },
        { orderId: { contains: variant, mode: 'insensitive' } },
        { id: variant },
        { id: { contains: variant, mode: 'insensitive' } },
        { customerId: variant },
        { customerId: { contains: variant, mode: 'insensitive' } },
      );
    });

    referencePaths.forEach((path) => {
      normalizedQueryVariants.forEach((variant) => {
        filters.push(
          { orderData: { path, equals: variant } },
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
        );
        if (/^\d+$/.test(variant)) {
          const variantNumber = Number(variant);
          if (Number.isFinite(variantNumber)) {
            filters.push({ orderData: { path, equals: variantNumber } });
          }
        }
      });
    });

    customerIdPaths.forEach((path) => {
      normalizedQueryVariants.forEach((variant) => {
        filters.push(
          { orderData: { path, equals: variant } },
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
        );
        if (/^\d+$/.test(variant)) {
          const variantNumber = Number(variant);
          if (Number.isFinite(variantNumber)) {
            filters.push({ orderData: { path, equals: variantNumber } });
          }
        }
      });
    });

    if (digitsOnlyQuery.length >= 5) {
      phonePaths.forEach((path) => {
        phoneVariants.forEach((variant) => {
          filters.push(
            { orderData: { path, string_contains: variant, mode: 'insensitive' } },
            { orderData: { path, equals: variant } },
          );
        });
      });

      phoneVariants.forEach((variant) => {
        sallaFilters.push(
          { customerMobile: { contains: variant } },
          { customerMobile: { equals: variant } },
        );
      });
    }

    const buildResponsePayload = (record: any, type: 'assignment' | 'history') => {
      const assignedName = type === 'assignment'
        ? (record.user as any)?.name || (record.user as any)?.username
        : record.userName;

      return {
        id: record.id,
        orderId: record.orderId,
        orderNumber: record.orderNumber,
        orderData: record.orderData,
        status: record.status,
        sallaStatus: type === 'assignment' ? record.sallaStatus : record.finalSallaStatus,
        assignedUserId: record.userId,
        assignedUserName: assignedName || '—',
        assignedAt: record.assignedAt.toISOString(),
        startedAt: record.startedAt ? record.startedAt.toISOString() : null,
        completedAt: type === 'assignment'
          ? (record.completedAt ? record.completedAt.toISOString() : null)
          : (record.finishedAt ? record.finishedAt.toISOString() : null),
        notes: record.notes,
        source: type,
      };
    };

    // Search for the order assignment
    const assignment = await prisma.orderAssignment.findFirst({
      where: {
        OR: filters,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        assignedAt: 'desc', // Get the most recent assignment
      },
    });

    if (assignment) {
      return NextResponse.json({
        success: true,
        assignment: buildResponsePayload(assignment, 'assignment'),
      });
    }

    const historyEntry = await prisma.orderHistory.findFirst({
      where: {
        OR: filters,
      },
      orderBy: {
        finishedAt: 'desc',
      },
    });

    if (historyEntry) {
      return NextResponse.json({
        success: true,
        assignment: buildResponsePayload(historyEntry, 'history'),
      });
    }

    if (sallaFilters.length > 0) {
      const sallaOrder = await prisma.sallaOrder.findFirst({
        where: {
          merchantId: MERCHANT_ID,
          OR: sallaFilters,
        },
        orderBy: {
          updatedAtRemote: 'desc',
        },
      });

      if (sallaOrder) {
        const placedAt = sallaOrder.placedAt || sallaOrder.updatedAtRemote || new Date();
        const orderData = (sallaOrder.rawOrder as any) || {
          id: sallaOrder.orderId,
          reference_id: sallaOrder.referenceId,
          customer: {
            first_name: sallaOrder.customerName,
            mobile: sallaOrder.customerMobile,
            email: sallaOrder.customerEmail,
            city: sallaOrder.customerCity,
            country: sallaOrder.customerCountry,
          },
          payment_status: sallaOrder.paymentStatus,
          payment_method: sallaOrder.paymentMethod,
          shipping_method: sallaOrder.fulfillmentCompany,
          delivery: {
            courier_name: sallaOrder.fulfillmentCompany,
            tracking_number: sallaOrder.trackingNumber,
          },
        };

        return NextResponse.json({
          success: true,
          assignment: {
            id: sallaOrder.id,
            orderId: sallaOrder.orderId,
            orderNumber: sallaOrder.orderNumber || sallaOrder.referenceId || sallaOrder.orderId,
            orderData,
            status: sallaOrder.statusSlug || sallaOrder.statusName || 'unknown',
            sallaStatus: sallaOrder.statusSlug,
            assignedUserId: 'salla-system',
            assignedUserName: 'بيانات سلة',
            assignedAt: placedAt.toISOString(),
            startedAt: null,
            completedAt: sallaOrder.updatedAtRemote ? sallaOrder.updatedAtRemote.toISOString() : null,
            notes: undefined,
            source: 'salla',
          },
        });
      }
    }

    return NextResponse.json({
      success: false,
      error: 'لم يتم العثور على الطلب'
    }, { status: 404 });
  } catch (error) {
    console.error('Error searching for order:', error);
    return NextResponse.json(
      { error: 'فشل في البحث عن الطلب' },
      { status: 500 }
    );
  }
}
