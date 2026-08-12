import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

import {
  buildInvoiceData,
  generateSallaInvoicePdf,
  type SellerInfo,
} from '../app/lib/salla-invoice-pdf';
import type { SallaOrder } from '../app/lib/salla-api';

const outputPath = path.join(process.cwd(), 'ZOKO_ORDER_INVOICE_SAMPLE.pdf');

const sampleOrder = {
  id: 100245,
  reference_id: '100245',
  order_number: '100245',
  status: { name: 'تحت المراجعة', slug: 'under_review' },
  date: {
    created: '2026-08-12 14:30:00',
    updated: '2026-08-12 14:30:00',
  },
  customer: {
    id: 1,
    first_name: 'سارة',
    last_name: 'محمد',
    full_name: 'سارة محمد',
    mobile: '0500000000',
    email: 'customer@example.com',
    city: 'الرياض',
  },
  ship_to: {
    country: 'السعودية',
    city: 'الرياض',
    district: 'حي الياسمين',
    address_line: 'عنوان تجريبي للاعتماد فقط',
    postal_code: '00000',
  },
  shipping: {
    company: 'شركة الشحن التجريبية',
    duration: 'من 3 إلى 5 أيام عمل',
  },
  payment_method: 'mada',
  amounts: {
    sub_total: { amount: 260, currency: 'SAR' },
    shipping_cost: { amount: 25, currency: 'SAR' },
    total_discount: { amount: 0, currency: 'SAR' },
    tax: { percent: 15, amount: { amount: 39, currency: 'SAR' } },
    total: { amount: 324, currency: 'SAR' },
  },
  items: [
    {
      id: 1,
      name: 'فستان تجريبي',
      sku: 'SAMPLE-DRESS-01',
      quantity: 1,
      currency: 'SAR',
      weight: 0.75,
      weight_label: 'كجم',
      options: [{ name: 'المقاس', value: 'M' }],
      amounts: {
        price_without_tax: { amount: 260, currency: 'SAR' },
        total_discount: { amount: 0, currency: 'SAR' },
        tax: { percent: '15', amount: { amount: 39, currency: 'SAR' } },
        total: { amount: 299, currency: 'SAR' },
      },
    },
  ],
} as unknown as SallaOrder;

const sampleSeller: SellerInfo = {
  nameAr: 'متجر مليحة — نموذج تجريبي',
  vatNumber: '000000000000000',
  crNumber: '0000000000',
  country: 'السعودية',
  city: 'الرياض',
  addressAr: 'عنوان تجريبي — غير صالح للاستخدام الضريبي',
  phone: '0500000000',
  email: 'sample@example.com',
};

async function main() {
  const invoiceData = buildInvoiceData(sampleOrder, {
    invoice_number: 'SAMPLE-100245',
    type: 'فاتورة ضريبية — نموذج تجريبي',
    date: '2026-08-12 14:30:00',
    payment_method: 'mada',
    sub_total: { amount: 260, currency: 'SAR' },
    shipping_cost: { amount: 25, currency: 'SAR' },
    cod_cost: { amount: 0, currency: 'SAR' },
    discount: { amount: 0, currency: 'SAR' },
    tax: { percent: 15, amount: { amount: 39, currency: 'SAR' } },
    total: { amount: 324, currency: 'SAR' },
  });

  const rendered = await generateSallaInvoicePdf(invoiceData, sampleSeller);
  const pdf = await PDFDocument.load(rendered);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const watermark = 'SAMPLE - FOR ZOKO TEMPLATE APPROVAL ONLY';

  for (const page of pdf.getPages()) {
    const { height } = page.getSize();
    page.drawText(watermark, {
      x: 55,
      y: height / 2 - 15,
      size: 27,
      font,
      color: rgb(0.72, 0.08, 0.08),
      opacity: 0.16,
      rotate: degrees(32),
    });
  }

  pdf.setTitle('Mleha sample invoice for Zoko template approval');
  pdf.setSubject('Fictional sample document; not a valid tax invoice');
  pdf.setCreator('Mleha App');
  await fs.writeFile(outputPath, await pdf.save());
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
