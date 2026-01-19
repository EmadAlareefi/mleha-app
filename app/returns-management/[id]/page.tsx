import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getSallaOrder, type SallaOrder } from '@/app/lib/salla-api';
import { trackC2BShipment } from '@/app/lib/smsa-api';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  INSPECTION_BADGE_STYLES,
} from '@/app/lib/returns/status';
import {
  CONDITION_LABELS,
  summarizeItemConditions,
} from '@/app/lib/returns/inspection';
import {
  resolveReturnItemImage,
  extractOrderItemImage,
} from '@/app/lib/returns/item-images';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CopyPhoneButton } from '@/components/CopyPhoneButton';

export const revalidate = 0;

const extractSmsaLabel = (payload: any): string | null => {
  if (!payload) return null;
  const awbFile =
    payload?.waybills?.[0]?.awbFile ??
    payload?.waybill?.awbFile ??
    payload?.awbFile ??
    null;
  if (typeof awbFile === 'string' && awbFile.trim()) {
    return awbFile.trim();
  }
  return null;
};

const gregorianDateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
});

const formatPrice = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '—';
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '—';
  }
  return `${amount.toFixed(2)} ر.س`;
};

const extractOrderItemTotal = (item: SallaOrder['items'][number]): string => {
  const total =
    item?.amounts?.total?.amount ??
    item?.amounts?.price_without_tax?.amount ??
    item?.amounts?.tax?.amount?.amount;
  if (total === undefined || total === null) {
    return '—';
  }
  return formatPrice(total);
};

async function getReturnRequestWithOrder(id: string) {
  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!returnRequest) {
    return null;
  }

  let sallaOrder: SallaOrder | null = null;
  try {
    sallaOrder = await getSallaOrder(returnRequest.merchantId, returnRequest.orderId);
  } catch (error) {
    console.error('Failed to fetch Salla order for details page', { error });
  }

  let smsaLabelBase64 = extractSmsaLabel(returnRequest.smsaResponse);

  if (!smsaLabelBase64 && returnRequest.smsaAwbNumber) {
    try {
      const latestLabel = await trackC2BShipment(returnRequest.smsaAwbNumber);
      smsaLabelBase64 = extractSmsaLabel(latestLabel);
    } catch (error) {
      console.error('Failed to fetch SMSA return label', {
        returnRequestId: returnRequest.id,
        awb: returnRequest.smsaAwbNumber,
        error,
      });
    }
  }

  const smsaLabelDataUrl = smsaLabelBase64
    ? `data:application/pdf;base64,${smsaLabelBase64}`
    : null;

  return { returnRequest, sallaOrder, smsaLabelDataUrl };
}

const badgeToneClasses: Record<string, string> = {
  success: INSPECTION_BADGE_STYLES.success,
  warning: INSPECTION_BADGE_STYLES.warning,
  danger: INSPECTION_BADGE_STYLES.danger,
  muted: INSPECTION_BADGE_STYLES.muted,
};

export default async function ReturnOrderDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getReturnRequestWithOrder(id);
  if (!data) {
    notFound();
  }
  const { returnRequest, sallaOrder, smsaLabelDataUrl } = data;
  const inspectionSummary = summarizeItemConditions(returnRequest.items);
  const itemsWithImages = returnRequest.items.map((item) => ({
    ...item,
    imageUrl: resolveReturnItemImage(item, sallaOrder?.items ?? null),
  }));
  const orderItemsWithImages = (sallaOrder?.items ?? []).map((item) => ({
    ...item,
    imageUrl: extractOrderItemImage(item),
  }));

  const statusClass =
    STATUS_COLORS[returnRequest.status] || 'bg-gray-100 text-gray-800 border-gray-300';

  const typeLabel = returnRequest.type === 'exchange' ? 'استبدال' : 'إرجاع';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm text-gray-500">تفاصيل طلب الإرجاع</p>
            <h1 className="text-3xl font-bold mt-1">طلب #{returnRequest.orderNumber}</h1>
            <div className="mt-4 flex flex-wrap gap-3">
              <span className="inline-flex items-center rounded-full border px-4 py-1 text-sm font-medium bg-orange-50 text-orange-700 border-orange-200">
                {typeLabel}
              </span>
              <span className={`inline-flex items-center rounded-full border px-4 py-1 text-sm font-medium ${statusClass}`}>
                {STATUS_LABELS[returnRequest.status] || returnRequest.status}
              </span>
            </div>
          </div>
          <Link href="/returns-management" className="self-start">
            <Button variant="outline">← العودة لقائمة الطلبات</Button>
          </Link>
        </div>

        <Card className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h2 className="text-lg font-semibold mb-3">معلومات الطلب</h2>
              <dl className="space-y-2 text-sm text-gray-700">
                <div className="flex justify-between">
                  <dt>التاريخ</dt>
                  <dd>{gregorianDateFormatter.format(new Date(returnRequest.createdAt))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>حالة سلة</dt>
                  <dd>{sallaOrder?.status?.name || '—'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-900">سبب الإرجاع</dt>
                  <dd>{returnRequest.reason}</dd>
                  {returnRequest.reasonDetails && (
                    <p className="text-gray-500 mt-1 text-xs">{returnRequest.reasonDetails}</p>
                  )}
                </div>
                {returnRequest.adminNotes && (
                  <div className="mt-3 p-3 rounded-md bg-blue-50 border border-blue-100">
                    <dt className="text-xs font-semibold text-blue-800">ملاحظات الإدارة</dt>
                    <dd className="text-sm text-blue-900 mt-1">{returnRequest.adminNotes}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-3">العميل</h2>
              <dl className="space-y-2 text-sm text-gray-700">
                <div className="flex justify-between">
                  <dt>الاسم</dt>
                  <dd>{returnRequest.customerName}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>الهاتف</dt>
                  <dd className="flex items-center gap-2">
                    <span>{returnRequest.customerPhone || '—'}</span>
                    {returnRequest.customerPhone ? (
                      <CopyPhoneButton phone={returnRequest.customerPhone} />
                    ) : null}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>البريد</dt>
                  <dd>{returnRequest.customerEmail || '—'}</dd>
                </div>
                {sallaOrder?.customer?.name && (
                  <div className="flex justify-between">
                    <dt>حساب سلة</dt>
                    <dd>{sallaOrder.customer.name}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-3">الشحن والمدفوعات</h2>
              <dl className="space-y-2 text-sm text-gray-700">
                <div className="flex justify-between">
                  <dt>رقم التتبع</dt>
                  <dd>{returnRequest.smsaTrackingNumber || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>AWB</dt>
                  <dd>{returnRequest.smsaAwbNumber || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>الرسوم</dt>
                  <dd>{returnRequest.returnFee ? formatPrice(returnRequest.returnFee) : '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>المبلغ المسترد</dt>
                  <dd>{returnRequest.totalRefundAmount ? formatPrice(returnRequest.totalRefundAmount) : '—'}</dd>
                </div>
                {returnRequest.couponCode && (
                  <div className="flex justify-between">
                    <dt>كود الكوبون</dt>
                    <dd>{returnRequest.couponCode}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-4 border border-gray-200 bg-gray-100">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">بوليصة مرتجع سمسا</h2>
              <p className="text-sm text-gray-500">
                يتم تحميل هذه البوليصة مباشرة من سمسا باستخدام رقم التتبع الخاص بالمرتجع.
              </p>
            </div>
            <div className="text-sm text-gray-600">
              AWB: {returnRequest.smsaAwbNumber || '—'}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-gray-700">
            <div>
              <p className="text-xs text-gray-500">رقم التتبع</p>
              <p className="font-medium text-gray-900">{returnRequest.smsaTrackingNumber || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">عدد القطع</p>
              <p className="font-medium text-gray-900">{returnRequest.items.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">حالة الطلب</p>
              <p className="font-medium text-gray-900">
                {STATUS_LABELS[returnRequest.status] || returnRequest.status}
              </p>
            </div>
          </div>
          {smsaLabelDataUrl ? (
            <>
              <div className="rounded-xl border bg-white overflow-hidden">
                <iframe
                  src={smsaLabelDataUrl}
                  title="SMSA Return Label"
                  className="w-full h-[600px]"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <a
                    href={smsaLabelDataUrl}
                    download={`smsa-return-label-${returnRequest.orderNumber}.pdf`}
                  >
                    تحميل البوليصة
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={smsaLabelDataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    فتح في نافذة جديدة
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-100 text-sm text-yellow-800">
              تعذر جلب بوليصة الشحنة من سمسا حالياً. تأكد من توفر رقم التتبع أو حاول لاحقاً.
            </div>
          )}
        </Card>

        <Card className="p-6 space-y-4 border border-gray-200 bg-gray-100">
          <div className="flex flex-wrap gap-2">
            {inspectionSummary.badges.map((badge) => (
              <span
                key={badge.label}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                  badgeToneClasses[badge.tone] || badgeToneClasses.muted
                }`}
              >
                {badge.label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div className="p-4 rounded-lg bg-gray-100">
              <p className="text-2xl font-semibold">{inspectionSummary.totalUnits}</p>
              <p className="text-sm text-gray-600">إجمالي القطع</p>
            </div>
            <div className="p-4 rounded-lg bg-green-50">
              <p className="text-2xl font-semibold">{inspectionSummary.inspectedUnits}</p>
              <p className="text-sm text-gray-600">تم الفحص</p>
            </div>
            <div className="p-4 rounded-lg bg-amber-50">
              <p className="text-2xl font-semibold">{inspectionSummary.outstandingUnits}</p>
              <p className="text-sm text-gray-600">بانتظار الفحص</p>
            </div>
            <div className="p-4 rounded-lg bg-red-50">
              <p className="text-2xl font-semibold">{inspectionSummary.flaggedUnits}</p>
              <p className="text-sm text-gray-600">بحاجة للانتباه</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">المنتجات المرتجعة</h2>
              <p className="text-sm text-gray-500">تفاصيل كل عنصر مع صورته</p>
            </div>
            {sallaOrder?.order_number && (
              <div className="text-sm text-gray-600">
                طلب سلة #{sallaOrder.order_number}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {itemsWithImages.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 border rounded-xl p-4 bg-white"
              >
                <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-gray-100 border">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.productName}
                      width={600}
                      height={800}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
                      لا توجد صورة متاحة
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">
                      {item.productName}
                    </span>
                    {item.variantName && (
                      <span className="text-gray-500">({item.variantName})</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm text-gray-600">
                    <div>
                      <p className="text-gray-500 text-xs">SKU</p>
                      <p>{item.productSku || '—'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">الكمية</p>
                      <p>x{item.quantity}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">السعر</p>
                      <p>{formatPrice(item.price)}</p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-xs text-gray-500">حالة الفحص</p>
                    <p className="text-sm font-medium text-gray-900">
                      {item.conditionStatus
                        ? CONDITION_LABELS[item.conditionStatus]
                        : 'بانتظار الفحص'}
                    </p>
                    {item.conditionNotes && (
                      <p className="text-xs text-gray-500 mt-1">{item.conditionNotes}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {itemsWithImages.length === 0 && (
              <div className="text-center text-gray-500 py-12">
                لا توجد عناصر مرتبطة بهذا الطلب.
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">جميع منتجات الطلب</h2>
              <p className="text-sm text-gray-500">
                القائمة الكاملة لعناصر الطلب كما وردت من سلة
              </p>
            </div>
            {sallaOrder?.items && sallaOrder.items.length > 0 && (
              <span className="text-sm text-gray-600">
                {sallaOrder.items.length} منتج
              </span>
            )}
          </div>

          {orderItemsWithImages.length > 0 ? (
            <div className="space-y-4">
              {orderItemsWithImages.map((item, index) => (
                <div
                  key={`${item.id ?? item.product?.id ?? index}`}
                  className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 rounded-xl border bg-white p-4"
                >
                  <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-gray-100 border">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.name || item.product?.name || `منتج #${item.id ?? index + 1}`}
                        width={600}
                        height={800}
                        className="h-full w-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
                        لا توجد صورة متاحة
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {item.name || item.product?.name || `منتج #${item.id ?? index + 1}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        SKU: {item.sku || item.product?.sku || '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                      <span>الكمية: x{item.quantity ?? 1}</span>
                      <span>السعر: {extractOrderItemTotal(item)}</span>
                      {item.variant?.name && <span>الخيار: {item.variant.name}</span>}
                    </div>
                    {item.notes && (
                      <p className="text-xs text-gray-500">ملاحظات: {item.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-6">
              لا تتوفر عناصر للطلب في بيانات سلة الحالية.
            </div>
          )}
        </Card>

        {returnRequest.reviewedBy && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-2">المراجعة</h2>
            <p className="text-sm text-gray-700">
              تمت مراجعة الطلب بواسطة{' '}
              <span className="font-medium text-gray-900">{returnRequest.reviewedBy}</span>
              {returnRequest.reviewedAt && (
                <> في {gregorianDateFormatter.format(new Date(returnRequest.reviewedAt))}</>
              )}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
