import React from 'react';

interface CommercialInvoiceProps {
  orderData: any;
  orderNumber: string;
}

export const CommercialInvoice = React.forwardRef<HTMLDivElement, CommercialInvoiceProps>(
  ({ orderData, orderNumber }, ref) => {
    const getStringValue = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj.name === 'string') return obj.name;
        if (typeof obj.label === 'string') return obj.label;
        if (obj.value !== undefined) {
          return getStringValue(obj.value);
        }
        return JSON.stringify(obj);
      }
      return '';
    };

    const getNumberValue = (value: unknown): number => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return Number.isNaN(parsed) ? 0 : parsed;
      }
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if (obj.value !== undefined) {
          return getNumberValue(obj.value);
        }
      }
      return 0;
    };

    const customer = orderData?.customer || {};
    const shippingAddress = orderData?.shipping_address || customer;
    const billingAddress = orderData?.billing_address || customer;
    const normalizeItems = (items: unknown): any[] => {
      if (Array.isArray(items)) {
        return items;
      }
      if (items && typeof items === 'object') {
        // Some historical orders store items as an object keyed by ID
        return Object.values(items as Record<string, any>);
      }
      return [];
    };

    const items = normalizeItems(orderData?.items);
    const amounts = orderData?.amounts || {};

    const customerName = `${getStringValue(customer.first_name)} ${getStringValue(customer.last_name)}`.trim();
    const country = getStringValue(shippingAddress.country || customer.country || billingAddress.country);
    const city = getStringValue(shippingAddress.city || customer.city || billingAddress.city);
    const address = getStringValue(shippingAddress.address || customer.address || billingAddress.address);
    const phone = getStringValue(customer.mobile_code || '') + getStringValue(customer.mobile || customer.phone);
    const email = getStringValue(customer.email);

    const subtotal = getNumberValue(amounts.sub_total?.amount);
    const shipping = getNumberValue(amounts.shipping_cost?.amount);
    const total = getNumberValue(amounts.total?.amount);
    const currency = getStringValue(amounts.total?.currency) || 'SAR';

    const currentDate = new Date().toLocaleDateString('en-GB');

    return (
      <div ref={ref} className="p-8 bg-white" style={{ width: '210mm', minHeight: '297mm' }}>
        {/* Header */}
        <div className="text-center mb-8 border-b-2 border-black pb-4">
          <h1 className="text-3xl font-bold mb-2">COMMERCIAL INVOICE</h1>
        </div>

        {/* Invoice Info */}
        <div className="grid grid-cols-2 gap-8 mb-6">
          <div>
            <p className="font-bold mb-1">Invoice Number:</p>
            <p className="border-b border-gray-400 pb-1">{orderNumber}</p>
          </div>
          <div>
            <p className="font-bold mb-1">Date:</p>
            <p className="border-b border-gray-400 pb-1">{currentDate}</p>
          </div>
        </div>

        {/* Shipper & Consignee Info */}
        <div className="grid grid-cols-2 gap-8 mb-6">
          {/* Shipper (Your Company) */}
          <div className="border border-black p-4">
            <h3 className="font-bold mb-3 border-b border-gray-400 pb-1">
              SHIPPER
            </h3>
            <div className="space-y-2 text-sm">
              <p className="font-bold">Maliha Trading Company</p>
              <p>Halab,7714 Halab, Al Baghdadiyah Al Gharbiyah</p>
              <p>Jeddah, 22234, 4443</p>
              <p>Saudi Arabia</p>
              <p>Tel: +966531349631</p>
            </div>
          </div>

          {/* Consignee (Customer) */}
          <div className="border border-black p-4">
            <h3 className="font-bold mb-3 border-b border-gray-400 pb-1">
              CONSIGNEE
            </h3>
            <div className="space-y-2 text-sm">
              <p className="font-bold">{customerName}</p>
              <p>{address}</p>
              <p>{city}</p>
              <p>{country}</p>
              {phone && <p>Tel: {phone}</p>}
              {email && <p>Email: {email}</p>}
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="mb-6">
          <table className="w-full border-collapse border border-black">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black p-2 text-left">S. No</th>
                <th className="border border-black p-2 text-left">Commodity Description</th>
                <th className="border border-black p-2 text-center">Quantity</th>
                <th className="border border-black p-2 text-center">Unit of Measure</th>
                <th className="border border-black p-2 text-right">Unit Value</th>
                <th className="border border-black p-2 text-center">Currency</th>
                <th className="border border-black p-2 text-right">Total Value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, index: number) => {
                const itemName = getStringValue(item.name);
                const itemNameAr = getStringValue(item.name_ar || item.nameAr || item.arabic_name);
                const quantity = getNumberValue(item.quantity);
                const unitPrice = getNumberValue(item.amounts?.price_without_tax?.amount || item.amounts?.price?.amount);
                const itemTotal = getNumberValue(item.amounts?.total_without_tax?.amount || item.amounts?.total?.amount);
                const itemCurrency = getStringValue(item.amounts?.price_without_tax?.currency || item.amounts?.price?.currency) || currency;

                // Translate Arabic product names to English
                let description = itemName;
                const combinedName = `${itemName} ${itemNameAr}`.toLowerCase();

                if (combinedName.includes('فستان')) {
                  description = 'Women Dress';
                } else if (combinedName.includes('طقم')) {
                  description = 'Women Set';
                }

                if (item.sku) {
                  description += ` (SKU: ${item.sku})`;
                }
                if (item.options && item.options.length > 0) {
                  const opts = item.options.map((opt: any) => {
                    let optName = getStringValue(opt.name);
                    // Translate Arabic option names to English
                    if (optName.includes('المقاسات') || optName.includes('المقاس')) {
                      optName = 'Size';
                    } else if (optName.includes('اللون')) {
                      optName = 'Color';
                    }
                    return `${optName}: ${getStringValue(opt.value)}`;
                  }).join(', ');
                  description += ` - ${opts}`;
                }

                return (
                  <tr key={index}>
                    <td className="border border-black p-2">{index + 1}</td>
                    <td className="border border-black p-2">{description}</td>
                    <td className="border border-black p-2 text-center">{quantity}</td>
                    <td className="border border-black p-2 text-center">PCS</td>
                    <td className="border border-black p-2 text-right">{unitPrice.toFixed(2)}</td>
                    <td className="border border-black p-2 text-center">{itemCurrency}</td>
                    <td className="border border-black p-2 text-right">{itemTotal.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end mb-6">
          <div className="w-1/2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-right font-bold">Subtotal:</div>
              <div className="text-right border-b border-gray-400">{subtotal.toFixed(2)} {currency}</div>

              <div className="text-right font-bold">Shipping:</div>
              <div className="text-right border-b border-gray-400">{shipping.toFixed(2)} {currency}</div>

              <div className="text-right font-bold text-lg pt-2">TOTAL:</div>
              <div className="text-right font-bold text-lg pt-2 border-t-2 border-black">
                {total.toFixed(2)} {currency}
              </div>
            </div>
          </div>
        </div>

        {/* Declaration */}
        <div className="border border-black p-4 mb-6 text-sm">
          <p className="font-bold mb-2">DECLARATION:</p>
          <p>
            I hereby declare that the information contained in this invoice is true and correct,
            and that the goods described are of the origin shown.
          </p>
        </div>

        {/* Signature */}
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="font-bold mb-12">Signature:</p>
            <div className="border-t border-black pt-2">
              <p className="text-sm">Authorized Signature</p>
            </div>
          </div>
          <div>
            <p className="font-bold mb-12">Date:</p>
            <div className="border-t border-black pt-2">
              <p className="text-sm">{currentDate}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-gray-600 border-t pt-4">
          <p>This is a computer generated invoice and does not require a physical signature</p>
        </div>
      </div>
    );
  }
);

CommercialInvoice.displayName = 'CommercialInvoice';
