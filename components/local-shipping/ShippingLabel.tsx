import React, { forwardRef } from 'react';
import Barcode from 'react-barcode';

interface ShippingLabelProps {
  shipment: {
    trackingNumber: string;
    orderNumber: string;
    customerName: string;
    customerPhone: string;
    shippingAddress: string;
    shippingCity: string;
    shippingPostcode?: string;
    orderTotal: number;
    itemsCount: number;
    orderItems?: any[];
    createdAt: string;
  };
  merchant: {
    name: string;
    phone: string;
    address: string;
    city: string;
  };
}

const ShippingLabel = forwardRef<HTMLDivElement, ShippingLabelProps>(
  ({ shipment, merchant }, ref) => {
    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    };

    return (
      <div ref={ref} className="shipping-label">
        {/* Print Styles */}
        <style jsx>{`
          @media print {
            .shipping-label {
              width: 100%;
              max-width: 100%;
              margin: 0;
              padding: 20px;
              background: white;
            }

            @page {
              size: A4;
              margin: 10mm;
            }
          }
        `}</style>

        {/* Label Container */}
        <div className="max-w-4xl mx-auto bg-white border-4 border-black p-8" dir="rtl">
          {/* Header */}
          <div className="border-b-4 border-black pb-6 mb-6">
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-2">ملصق شحن محلي</h1>
              <p className="text-2xl text-gray-600">LOCAL SHIPPING LABEL</p>
            </div>
          </div>

          {/* Tracking Number Section */}
          <div className="bg-black text-white p-6 rounded-lg mb-6 text-center">
            <p className="text-sm mb-2">رقم التتبع / Tracking Number</p>
            <p className="text-3xl font-bold font-mono mb-4">{shipment.trackingNumber}</p>
            <div className="bg-white p-4 rounded">
              <Barcode
                value={shipment.trackingNumber}
                height={60}
                displayValue={false}
                background="#ffffff"
              />
            </div>
          </div>

          {/* Order Information */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="border-2 border-gray-300 rounded-lg p-4">
              <h3 className="text-lg font-bold mb-3 bg-gray-100 px-3 py-2 rounded">
                معلومات الطلب / Order Info
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">رقم الطلب:</span>
                  <span className="font-bold">{shipment.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">التاريخ:</span>
                  <span className="font-bold">{formatDate(shipment.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">عدد القطع:</span>
                  <span className="font-bold">{shipment.itemsCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">المبلغ الإجمالي:</span>
                  <span className="font-bold">{shipment.orderTotal} ريال</span>
                </div>
              </div>
            </div>

            <div className="border-2 border-gray-300 rounded-lg p-4">
              <h3 className="text-lg font-bold mb-3 bg-gray-100 px-3 py-2 rounded">
                معلومات المرسل / From
              </h3>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-600">الاسم:</span>
                  <p className="font-bold">{merchant.name}</p>
                </div>
                <div>
                  <span className="text-gray-600">الهاتف:</span>
                  <p className="font-bold">{merchant.phone}</p>
                </div>
                <div>
                  <span className="text-gray-600">العنوان:</span>
                  <p className="font-bold">{merchant.address}</p>
                </div>
                <div>
                  <span className="text-gray-600">المدينة:</span>
                  <p className="font-bold">{merchant.city}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Recipient Information - Large and Prominent */}
          <div className="border-4 border-black rounded-lg p-6 mb-6 bg-yellow-50">
            <h3 className="text-2xl font-bold mb-4 flex items-center gap-3">
              <span className="bg-black text-white px-4 py-2 rounded">إلى / TO</span>
              <span>معلومات المستلم</span>
            </h3>
            <div className="space-y-3">
              <div className="bg-white p-4 rounded-lg border-2 border-gray-300">
                <span className="text-gray-600 text-sm">الاسم / Name:</span>
                <p className="text-2xl font-bold mt-1">{shipment.customerName}</p>
              </div>
              <div className="bg-white p-4 rounded-lg border-2 border-gray-300">
                <span className="text-gray-600 text-sm">الهاتف / Phone:</span>
                <p className="text-2xl font-bold mt-1" dir="ltr">{shipment.customerPhone}</p>
              </div>
              <div className="bg-white p-4 rounded-lg border-2 border-gray-300">
                <span className="text-gray-600 text-sm">العنوان / Address:</span>
                <p className="text-xl font-bold mt-1">{shipment.shippingAddress}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-lg border-2 border-gray-300">
                  <span className="text-gray-600 text-sm">المدينة / City:</span>
                  <p className="text-xl font-bold mt-1">{shipment.shippingCity}</p>
                </div>
                {shipment.shippingPostcode && (
                  <div className="bg-white p-4 rounded-lg border-2 border-gray-300">
                    <span className="text-gray-600 text-sm">الرمز البريدي:</span>
                    <p className="text-xl font-bold mt-1">{shipment.shippingPostcode}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Order Items */}
          {shipment.orderItems && shipment.orderItems.length > 0 && (
            <div className="border-2 border-gray-300 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-bold mb-3 bg-gray-100 px-3 py-2 rounded">
                محتويات الطلب / Items
              </h3>
              <div className="space-y-2">
                {shipment.orderItems.map((item: any, index: number) => (
                  <div
                    key={index}
                    className="flex justify-between items-center py-2 border-b last:border-b-0"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{item.product?.name || 'منتج'}</p>
                      {item.variant?.name && (
                        <p className="text-sm text-gray-600">{item.variant.name}</p>
                      )}
                    </div>
                    <div className="text-left px-4">
                      <span className="font-bold">x{item.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t-2 border-gray-300 pt-4 mt-6">
            <div className="text-center text-sm text-gray-600">
              <p>يرجى التحقق من الطلب عند الاستلام</p>
              <p className="text-xs mt-1">Please verify order upon delivery</p>
            </div>
          </div>

          {/* Signature Section */}
          <div className="grid grid-cols-2 gap-8 mt-6 pt-6 border-t-2 border-gray-300">
            <div>
              <p className="text-sm text-gray-600 mb-2">توقيع المستلم / Recipient Signature</p>
              <div className="border-b-2 border-gray-400 h-16"></div>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-2">التاريخ / Date</p>
              <div className="border-b-2 border-gray-400 h-16"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ShippingLabel.displayName = 'ShippingLabel';

export default ShippingLabel;
