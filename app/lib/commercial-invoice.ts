import { PDFDocument, StandardFonts } from 'pdf-lib';

const SAUDI_CODES = ['SA', 'SAU', 'SAUDI ARABIA', 'السعودية', 'المملكة العربية السعودية'];
const SHIPPER_INFO = [
  'Maliha Trading Company',
  'Halab,7714 Halab, Al Baghdadiyah Al Gharbiyah',
  'Jeddah, 22234, 4443',
  'Saudi Arabia',
  'Tel: +966531349631',
];

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 40;
const ARABIC_CHAR_REGEX = /[\u0600-\u06FF]/;
const ARABIC_TO_LATIN: Record<string, string> = {
  ا: 'a',
  أ: 'a',
  إ: 'i',
  آ: 'a',
  ب: 'b',
  ت: 't',
  ث: 'th',
  ج: 'j',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'dh',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'z',
  ع: 'a',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  و: 'w',
  ي: 'y',
  ء: '',
  ئ: 'y',
  ة: 'h',
  ى: 'a',
  ؤ: 'w',
  '،': ',',
  '؛': ';',
  '؟': '?',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  'ْ': '',
  'ٌ': '',
  'ٍ': '',
  'ً': '',
  'ُ': '',
  'ِ': '',
  'َ': '',
  'ّ': '',
  'ـ': '',
};

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

const transliterateArabic = (text: string): string =>
  text
    .split('')
    .map((char) => ARABIC_TO_LATIN[char] ?? char)
    .join('');

const stripNonAscii = (text: string): string =>
  text
    .split('')
    .map((char) => (char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126 ? char : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const ensureEnglishText = (text: string): string => {
  const normalized = text?.toString()?.trim() || '';
  if (!normalized) return '';
  const transliterated = ARABIC_CHAR_REGEX.test(normalized) ? transliterateArabic(normalized) : normalized;
  return stripNonAscii(transliterated);
};

const getEnglishString = (value: unknown): string => ensureEnglishText(getStringValue(value));

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

const normalizeItems = (items: unknown): any[] => {
  if (Array.isArray(items)) {
    return items;
  }
  if (items && typeof items === 'object') {
    return Object.values(items as Record<string, any>);
  }
  return [];
};

export const detectInternationalOrder = (orderData: any): { isInternational: boolean; country: string } => {
  const countryCandidates = [
    orderData?.shipping_address?.country,
    orderData?.billing_address?.country,
    orderData?.customer?.country,
  ];

  const country = countryCandidates
    .map((value) => getStringValue(value))
    .find((value) => Boolean(value)) || '';

  if (!country) {
    return { isInternational: false, country: '' };
  }

  const isInternational = !SAUDI_CODES.some((code) => country.toUpperCase() === code.toUpperCase());
  return { isInternational, country };
};

export async function generateCommercialInvoicePdf(orderData: any, orderNumber: string): Promise<Buffer> {
  const customer = orderData?.customer || {};
  const shippingAddress = orderData?.shipping_address || customer;
  const billingAddress = orderData?.billing_address || customer;
  const items = normalizeItems(orderData?.items);
  const amounts = orderData?.amounts || {};

  const customerName =
    `${getEnglishString(customer.first_name)} ${getEnglishString(customer.last_name)}`.trim() ||
    getEnglishString(customer.name);
  const country = getEnglishString(shippingAddress.country || customer.country || billingAddress.country);
  const city = getEnglishString(shippingAddress.city || customer.city || billingAddress.city);
  const address = getEnglishString(shippingAddress.address || customer.address || billingAddress.address);
  const phone = ensureEnglishText(
    `${getStringValue(customer.mobile_code || '')}${getStringValue(customer.mobile || customer.phone)}`
  );
  const email = getEnglishString(customer.email);

  const subtotal = getNumberValue(amounts.sub_total?.amount);
  const shipping = getNumberValue(amounts.shipping_cost?.amount);
  const total = getNumberValue(amounts.total?.amount);
  const currency = getStringValue(amounts.total?.currency) || 'SAR';
  const currentDate = new Date().toLocaleDateString('en-GB');

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let cursorY = page.getHeight() - PAGE_MARGIN;

  const moveToNextLine = (lineHeight = 16) => {
    cursorY -= lineHeight;
    if (cursorY <= PAGE_MARGIN) {
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
      cursorY = page.getHeight() - PAGE_MARGIN;
    }
  };

  const drawText = (text: string, options?: { size?: number; bold?: boolean; x?: number }) => {
    const font = options?.bold ? boldFont : regularFont;
    const size = options?.size ?? 11;
    const x = options?.x ?? PAGE_MARGIN;
    page.drawText(ensureEnglishText(text), { x, y: cursorY, size, font });
    moveToNextLine(size + 4);
  };

  const drawSection = (title: string, lines: string[]) => {
    drawText(title, { bold: true, size: 12 });
    lines
      .map(ensureEnglishText)
      .filter(Boolean)
      .forEach((line) => {
        drawText(`- ${line}`, { size: 10 });
      });
    moveToNextLine();
  };

  const drawCenteredHeader = (text: string, size: number) => {
    const font = boldFont;
    const textWidth = font.widthOfTextAtSize(text, size);
    const x = (page.getWidth() - textWidth) / 2;
    page.drawText(text, { x, y: cursorY, size, font });
    moveToNextLine(size + 8);
  };

  const drawKeyValue = (label: string, value: string) => {
    const labelText = `${label}: `;
    const labelWidth = boldFont.widthOfTextAtSize(labelText, 10);
    page.drawText(labelText, { x: PAGE_MARGIN, y: cursorY, size: 10, font: boldFont });
    page.drawText(ensureEnglishText(value), { x: PAGE_MARGIN + labelWidth, y: cursorY, size: 10, font: regularFont });
    moveToNextLine(14);
  };

  const drawDivider = () => {
    page.drawLine({
      start: { x: PAGE_MARGIN, y: cursorY + 6 },
      end: { x: page.getWidth() - PAGE_MARGIN, y: cursorY + 6 },
      thickness: 0.5,
    });
    moveToNextLine();
  };

  drawCenteredHeader('COMMERCIAL INVOICE', 22);

  drawKeyValue('Invoice Number', orderNumber || 'N/A');
  drawKeyValue('Date', currentDate);
  moveToNextLine();

  drawSection('SHIPPER', SHIPPER_INFO);
  drawSection(
    'CONSIGNEE',
    [
      customerName || 'N/A',
      address || 'N/A',
      city || '',
      country || '',
      phone ? `Tel: ${phone}` : '',
      email ? `Email: ${email}` : '',
    ].map(ensureEnglishText)
  );
  drawDivider();

  drawText('ITEMS', { bold: true, size: 12 });

  const columnTemplate = (values: string[]) => {
    const widths = [4, 42, 6, 6, 12, 9, 12];
    return values
      .map((value, index) => {
        const width = widths[index];
        let text = value;
        if (text.length > width) {
          text = `${text.slice(0, width - 1)}…`;
        }
        return text.padEnd(width, ' ');
      })
      .join('');
  };

  drawText(columnTemplate(['No', 'Description', 'Qty', 'Unit', 'Unit Value', 'Currency', 'Total']), {
    size: 9,
    bold: true,
  });

  if (items.length === 0) {
    drawText(columnTemplate(['-', 'No items found for this order', '', '', '', '', '']), { size: 9 });
  } else {
    items.forEach((item: any, index: number) => {
      const itemName = getEnglishString(item.name) || 'Item';
      const itemNameAr = getEnglishString(item.name_ar || item.nameAr || item.arabic_name);
      const quantity = getNumberValue(item.quantity);
      const unitPrice = getNumberValue(item.amounts?.price_without_tax?.amount || item.amounts?.price?.amount);
      const itemTotal = getNumberValue(item.amounts?.total_without_tax?.amount || item.amounts?.total?.amount);
      const itemCurrency = getStringValue(
        item.amounts?.price_without_tax?.currency || item.amounts?.price?.currency || currency
      ) || currency;

      const descriptionParts = [itemName];
      if (item.sku) descriptionParts.push(`SKU: ${item.sku}`);
      if (itemNameAr) descriptionParts.push(itemNameAr);
      if (Array.isArray(item.options) && item.options.length > 0) {
        const opts = item.options
          .map((opt: any) => `${getEnglishString(opt.name)}: ${getEnglishString(opt.value)}`)
          .join(', ');
        if (opts) {
          descriptionParts.push(opts);
        }
      }

      const description = ensureEnglishText(descriptionParts.filter(Boolean).join(' - '));

      drawText(
        columnTemplate([
          String(index + 1),
          description,
          quantity ? String(quantity) : '0',
          'PCS',
          unitPrice ? unitPrice.toFixed(2) : '0.00',
          itemCurrency,
          itemTotal ? itemTotal.toFixed(2) : '0.00',
        ]),
        { size: 9 }
      );
    });
  }

  moveToNextLine(18);
  drawText(`Subtotal: ${subtotal.toFixed(2)} ${currency}`, { bold: true });
  drawText(`Shipping: ${shipping.toFixed(2)} ${currency}`, { bold: true });
  drawText(`TOTAL: ${total.toFixed(2)} ${currency}`, { bold: true, size: 12 });

  moveToNextLine(20);
  drawText('I declare that the information contained in this invoice is true and correct.', { size: 10 });
  moveToNextLine(30);
  drawText('______________________________', { size: 10 });
  drawText('Authorized Signature', { size: 10 });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
