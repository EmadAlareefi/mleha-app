'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface SuccessScreenProps {
  returnRequest: {
    id: string;
    orderNumber: string;
    type: 'return' | 'exchange';
    status: string;
    smsaTrackingNumber?: string;
    smsaLabelDataUrl?: string | null;
    totalRefundAmount?: number;
    createdAt: string;
  };
  onReset?: () => void;
}

export default function SuccessScreen({ returnRequest, onReset }: SuccessScreenProps) {
  const hasLabel = Boolean(returnRequest.smsaLabelDataUrl);
  const downloadFileName = `smsa-return-label-${returnRequest.smsaTrackingNumber || returnRequest.orderNumber}.pdf`;

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="p-8">
        {/* Success Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <svg
              className="w-12 h-12 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        {/* Success Message */}
        <h2 className="text-2xl font-bold text-center mb-2">
          تم استلام طلب {returnRequest.type === 'return' ? 'الإرجاع' : 'الاستبدال'} بنجاح!
        </h2>
        <p className="text-center text-gray-600 mb-8">
          سيتم مراجعة طلبك والتواصل معك قريباً
        </p>

        {/* Reference Numbers */}
        <div className="space-y-4 mb-8">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">رقم المرجع</p>
            <p className="text-lg font-mono font-semibold">{returnRequest.id}</p>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">رقم الطلب الأصلي</p>
            <p className="text-lg font-mono font-semibold">{returnRequest.orderNumber}</p>
          </div>

          {returnRequest.smsaTrackingNumber && (
            <div className="p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
              <p className="text-sm text-gray-600 mb-1">رقم تتبع شحنة الإرجاع (SMSA)</p>
              <p className="text-lg font-mono font-semibold text-blue-700">
                {returnRequest.smsaTrackingNumber}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                استخدم هذا الرقم لتتبع شحنة الإرجاع
              </p>
            </div>
          )}

          {hasLabel && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">ملصق شحنة الإرجاع</p>
                  <p className="text-xs text-gray-500">
                    اطبع الملصق وضعه على الطرد قبل تسليم الشحنة لشركة الشحن
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={returnRequest.smsaLabelDataUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      فتح في نافذة جديدة
                    </a>
                  </Button>
                  <Button asChild size="sm">
                    <a
                      href={returnRequest.smsaLabelDataUrl || undefined}
                      download={downloadFileName}
                    >
                      تحميل الملصق
                    </a>
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                <iframe
                  title="ملصق شحنة الإرجاع"
                  src={returnRequest.smsaLabelDataUrl || undefined}
                  className="w-full h-96"
                />
              </div>
            </div>
          )}

          {returnRequest.type === 'return' && returnRequest.totalRefundAmount && (
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">مبلغ الاسترداد المتوقع</p>
              <p className="text-lg font-semibold text-green-700">
                {returnRequest.totalRefundAmount} ريال
              </p>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2">الخطوات التالية:</h3>
          <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
            <li>انتظر اتصال فريق خدمة العملاء للتأكيد</li>
            <li>قم بتجهيز المنتجات للإرجاع في عبوتها الأصلية إن أمكن</li>
            <li>سيتم ترتيب استلام الشحنة من قبل SMSA</li>
            <li>بعد استلام المنتجات ومراجعتها، سيتم معالجة الاسترداد</li>
          </ol>
        </div>

        {/* Status */}
        <div className="text-center mb-6">
          <span className="inline-block px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
            الحالة: {getStatusLabel(returnRequest.status)}
          </span>
        </div>

        {/* Print Button */}
        <div className="flex gap-4">
          <Button
            onClick={() => window.print()}
            variant="outline"
            className="flex-1"
          >
            طباعة
          </Button>

          {onReset && (
            <Button
              onClick={onReset}
              className="flex-1"
            >
              تقديم طلب آخر
            </Button>
          )}
        </div>

        {/* Contact Info */}
        <div className="mt-8 pt-6 border-t text-center text-sm text-gray-600">
          <p>إذا كان لديك أي استفسار، يرجى التواصل مع فريق خدمة العملاء</p>
          <p className="mt-1">
            واذكر رقم المرجع: <span className="font-mono font-semibold">{returnRequest.id}</span>
          </p>
        </div>
      </Card>
    </div>
  );
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_review: 'قيد المراجعة',
    approved: 'تمت الموافقة',
    rejected: 'مرفوض',
    completed: 'مكتمل',
    cancelled: 'ملغي',
  };
  return labels[status] || status;
}
