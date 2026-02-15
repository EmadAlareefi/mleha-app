import React, { forwardRef } from 'react';
import Image from 'next/image';
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
    collectionAmount?: number;
    paymentMethod?: string;
  };
  merchant: {
    name: string;
    phone: string;
    address: string;
    city: string;
    logoUrl?: string;
  };
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(
    Number.isFinite(value) ? value : 0
  );

const CODE39_ALLOWED_CHARS = new Set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%');

const normalizeOrderNumberForBarcode = (value: string) => {
  if (!value) return '0';
  const asciiValue = value
    .toString()
    .trim()
    .replace(/[\u0660-\u0669]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0x0660 + 48)
    )
    .toUpperCase();

  const sanitized = asciiValue
    .split('')
    .map((char) => (CODE39_ALLOWED_CHARS.has(char) ? char : '-'))
    .join('')
    .replace(/-+/g, '-');

  return sanitized || '0';
};

const ShippingLabel = forwardRef<HTMLDivElement, ShippingLabelProps>(
  ({ shipment, merchant }, ref) => {
    const logoSrc = merchant.logoUrl || '/logo.png';
    const amountToCollect =
      typeof shipment.collectionAmount === 'number'
        ? shipment.collectionAmount
        : shipment.orderTotal;

    const isCOD = amountToCollect > 0;

    return (
      <div ref={ref} className="shipping-label">
        <style jsx>{`
          .label-shell {
            width: 100mm;
            min-height: 150mm;
            background: white;
            overflow: hidden;
          }

          @media print {
            .shipping-label {
              width: auto;
              padding: 0;
              margin: 0;
              background: white;
            }

            .label-shell {
              width: 100mm !important;
              min-height: 150mm !important;
              margin: 0;
            }

            @page {
              size: 100mm 150mm;
              margin: 3mm;
            }
          }
        `}</style>

        <div className="label-shell border-4 border-black" dir="ltr">
          {/* Top DHL-inspired banner */}
          <div className="bg-[#ffcc00] border-b-4 border-black flex items-stretch">
            <div className="flex-1 flex items-center gap-3 border-r-4 border-black px-4 py-3">
              <div className="relative h-10 w-20 bg-white rounded-sm flex items-center justify-center">
                <Image
                  src={logoSrc}
                  alt={`Logo ${merchant.name}`}
                  fill
                  sizes="120px"
                  unoptimized
                  className="object-contain p-1"
                />
              </div>
              <div className="text-xs font-semibold text-black leading-tight text-right">
                <p className="uppercase tracking-wide">LOCAL EXPRESS</p>
                <p>{merchant.name}</p>
              </div>
            </div>
            <div className="w-28 flex flex-col items-center justify-center px-3 py-2">
              <p className="text-[10px] font-semibold">SERVICE</p>
              <p className="text-2xl font-black tracking-wide">{isCOD ? 'COD' : 'PD'}</p>
            </div>
          </div>

          {/* AWB and barcode */}
          <div className="border-b-4 border-black px-4 py-3">
            <div className="flex justify-between items-center mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-gray-500">
                  AIR WAYBILL / TRACKING
                </p>
                <p className="text-3xl font-black tracking-widest">
                  {shipment.trackingNumber}
                </p>
              </div>
              <div className="text-right text-xs">
                <p className="font-semibold">Order #{shipment.orderNumber}</p>
                <p>Pieces: {shipment.itemsCount}</p>
              </div>
            </div>
            <div className="bg-white border-2 border-black px-2 py-1 text-center">
              <Barcode
                value={normalizeOrderNumberForBarcode(shipment.orderNumber)}
                format="CODE39"
                height={60}
                displayValue={false}
                background="#ffffff"
                width={2}
                margin={0}
              />
            </div>
          </div>

          {/* Addresses */}
          <div className="px-4 py-3 border-b-4 border-black text-right" dir="rtl">
            <div className="grid grid-cols-2 gap-3">
              <div className="border-2 border-black rounded-sm p-3 h-full bg-gray-50">
                <p className="text-[10px] font-semibold text-gray-600 mb-1">من / FROM</p>
                <p className="text-lg font-bold">{merchant.name}</p>
                <p className="text-sm font-semibold">{merchant.address}</p>
                <p className="text-sm">{merchant.city}</p>
                <p className="text-sm">هاتف: {merchant.phone}</p>
              </div>
              <div className="border-2 border-black rounded-sm p-3 h-full bg-white">
                <p className="text-[10px] font-semibold text-gray-600 mb-1">إلى / TO</p>
                <p className="text-xl font-black">{shipment.customerName}</p>
                <p className="text-sm font-semibold">{shipment.shippingAddress}</p>
                <p className="text-sm">{shipment.shippingCity}</p>
                {shipment.shippingPostcode && (
                  <p className="text-sm">الرمز: {shipment.shippingPostcode}</p>
                )}
                <p className="text-sm" dir="ltr">
                  Phone: {shipment.customerPhone}
                </p>
              </div>
            </div>
          </div>

          {/* Amount due + meta */}
          <div className="px-4 py-3 border-b-4 border-black bg-[#fff7d6]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-gray-600">
                  مبلغ التحصيل / Amount to Collect
                </p>
                <p className="text-3xl font-black tracking-wide">
                  {formatCurrency(amountToCollect)}
                </p>
              </div>
              <div className="text-right text-xs font-semibold">
                <p>طريقة الدفع / Payment</p>
                <p className="text-lg">
                  {shipment.paymentMethod ||
                    (isCOD ? 'Cash On Delivery' : 'Paid (Prepaid)')}
                </p>
              </div>
            </div>
          </div>

          {/* Order contents */}
          {shipment.orderItems && shipment.orderItems.length > 0 && (
            <div className="px-4 py-3 border-b-4 border-black" dir="rtl">
              <p className="text-[10px] font-semibold text-gray-600 mb-2">
                محتويات الشحنة / Shipment Contents
              </p>
              <div className="space-y-1 text-sm">
                {shipment.orderItems.map((item: any, index: number) => (
                  <div
                    key={`${item.product?.id ?? index}-${index}`}
                    className="flex justify-between border-b border-dashed last:border-none py-1"
                  >
                    <span className="font-medium">
                      {item.product?.name || item.name || 'منتج'}
                    </span>
                    <span className="font-bold">x{item.quantity ?? 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-3 text-center text-[10px] leading-tight bg-white">
            <p>يجب على شركة الشحن تسليم المبلغ بالكامل للمرسل.</p>
            <p>التأكد من هوية المستلم والتوقيع رقميًا فقط عند التسليم.</p>
          </div>
        </div>
      </div>
    );
  }
);

ShippingLabel.displayName = 'ShippingLabel';

export default ShippingLabel;
