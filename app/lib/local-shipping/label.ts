import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFPage, PDFFont, RGB } from 'pdf-lib';
import type { LocalShipment } from '@prisma/client';
import { normalizeOrderItems } from './serializer';

const MM_TO_POINTS = 72 / 25.4;
const LABEL_WIDTH_MM = 100;
const LABEL_HEIGHT_MM = 150;
const PAGE_MARGIN_MM = 4;
const CODE39_PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnnwn',
  ' ': 'nwwnnwnnn',
  '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

const mmToPt = (value: number) => value * MM_TO_POINTS;

const formatCurrency = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${safe.toFixed(2)} SAR`;
  }
};

const isArabicText = (value: string) => /[\u0600-\u06FF]/.test(value);

const wrapText = (text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] => {
  if (!text) return [];
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  });

  if (current) {
    lines.push(current);
  }

  return lines;
};

const drawText = (
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    font: PDFFont;
    size: number;
    color?: RGB;
    maxWidth?: number;
    lineHeight?: number;
    align?: 'left' | 'right';
  },
) => {
  const { x, y, font, size, color = rgb(0, 0, 0), maxWidth, lineHeight = size + 2, align = 'left' } =
    options;
  const useArabicLayout = isArabicText(text);
  if (!maxWidth) {
    const content = useArabicLayout ? text.split('').reverse().join('') : text;
    const width = font.widthOfTextAtSize(content, size);
    const targetX = align === 'right' ? x - width : x;
    page.drawText(content, { x: targetX, y, size, font, color });
    return lineHeight;
  }

  if (useArabicLayout) {
    // Reverse characters to keep right-to-left order even without shaping
    const reversed = text.split('').reverse().join('');
    const width = font.widthOfTextAtSize(reversed, size);
    const targetX = align === 'right' ? x - Math.min(width, maxWidth) : x;
    page.drawText(reversed, { x: targetX, y, size, font, color });
    return lineHeight;
  }

  const lines = wrapText(text, font, size, maxWidth);
  lines.forEach((line, index) => {
    const width = font.widthOfTextAtSize(line, size);
    const expectedX = align === 'right' ? x - width : x;
    page.drawText(line, {
      x: expectedX,
      y: y - index * lineHeight,
      size,
      font,
      color,
    });
  });

  return lines.length * lineHeight;
};

const drawCode39Barcode = (
  page: PDFPage,
  value: string,
  opts: { x: number; y: number; width: number; height: number; color?: RGB },
) => {
  const sanitized = `*${value
    .toUpperCase()
    .split('')
    .map((char) => (CODE39_PATTERNS[char] ? char : '-'))
    .join('')}*`;
  const modules: { type: 'bar' | 'space'; units: number }[] = [];
  let totalUnits = 0;

  for (const char of sanitized) {
    const pattern = CODE39_PATTERNS[char];
    if (!pattern) continue;
    for (let index = 0; index < pattern.length; index += 1) {
      const type: 'bar' | 'space' = index % 2 === 0 ? 'bar' : 'space';
      const units = pattern[index] === 'w' ? 3 : 1;
      modules.push({ type, units });
      totalUnits += units;
    }
    modules.push({ type: 'space', units: 1 });
    totalUnits += 1;
  }

  modules.pop();
  const moduleWidth = opts.width / totalUnits;
  let cursor = opts.x;

  modules.forEach((module) => {
    const width = module.units * moduleWidth;
    if (module.type === 'bar') {
      page.drawRectangle({
        x: cursor,
        y: opts.y,
        width,
        height: opts.height,
        color: opts.color ?? rgb(0, 0, 0),
      });
    }
    cursor += width;
  });
};

export interface MerchantLabelInfo {
  name: string;
  phone: string;
  address: string;
  city: string;
}

export const getMerchantLabelInfo = (): MerchantLabelInfo => ({
  name: process.env.NEXT_PUBLIC_MERCHANT_NAME || 'متجر محلي',
  phone: process.env.NEXT_PUBLIC_MERCHANT_PHONE || '0500000000',
  address: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || 'الرياض - المملكة العربية السعودية',
  city: process.env.NEXT_PUBLIC_MERCHANT_CITY || 'الرياض',
});

export async function generateLocalShipmentLabelPdf(
  shipment: LocalShipment,
  merchant: MerchantLabelInfo = getMerchantLabelInfo(),
) {
  const pdfDoc = await PDFDocument.create();
  const pageWidth = mmToPt(LABEL_WIDTH_MM);
  const pageHeight = mmToPt(LABEL_HEIGHT_MM);
  const margin = mmToPt(PAGE_MARGIN_MM);

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const normalized = normalizeOrderItems(shipment.orderItems);
  const amountToCollectRaw = normalized.meta.collectionAmount ?? Number(shipment.orderTotal);
  const amountToCollect = shipment.isCOD ? amountToCollectRaw : 0;
  const paymentLabel = normalized.meta.paymentMethod || (shipment.isCOD ? 'Cash On Delivery' : 'Prepaid');
  const createdDate = new Date(shipment.createdAt).toLocaleDateString('ar-SA');

  // Header
  const headerHeight = mmToPt(20);
  page.drawRectangle({
    x: 0,
    y: pageHeight - headerHeight,
    width: pageWidth,
    height: headerHeight,
    color: rgb(1, 0.89, 0.2),
  });

  drawText(page, 'LOCAL EXPRESS', {
    x: margin,
    y: pageHeight - margin - 10,
    font: boldFont,
    size: 14,
  });
  drawText(page, merchant.name, {
    x: margin,
    y: pageHeight - margin - 24,
    font: regularFont,
    size: 11,
  });
  drawText(page, `تاريخ الطلب: ${createdDate}`, {
    x: pageWidth - margin,
    y: pageHeight - margin - 24,
    font: regularFont,
    size: 9,
    align: 'right',
  });

  let cursorY = pageHeight - headerHeight - mmToPt(4);

  drawText(page, 'AIR WAYBILL / TRACKING', {
    x: margin,
    y: cursorY,
    font: regularFont,
    size: 8,
  });
  cursorY -= 12;

  drawText(page, shipment.trackingNumber, {
    x: margin,
    y: cursorY,
    font: boldFont,
    size: 18,
  });
  cursorY -= mmToPt(10);

  const barcodeHeight = mmToPt(24);
  drawCode39Barcode(page, shipment.trackingNumber, {
    x: margin,
    y: cursorY - barcodeHeight,
    width: pageWidth - margin * 2,
    height: barcodeHeight,
  });
  cursorY -= barcodeHeight + mmToPt(6);

  // Order info row
  drawText(page, `Order #${shipment.orderNumber}`, {
    x: margin,
    y: cursorY,
    font: boldFont,
    size: 12,
  });
  drawText(page, `القطع: ${shipment.itemsCount}`, {
    x: pageWidth - margin,
    y: cursorY,
    font: boldFont,
    size: 12,
    align: 'right',
  });

  cursorY -= mmToPt(10);

  // Addresses
  const columnWidth = (pageWidth - margin * 2 - mmToPt(4)) / 2;
  const blockHeight = mmToPt(38);

  page.drawRectangle({
    x: margin,
    y: cursorY - blockHeight,
    width: columnWidth,
    height: blockHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  page.drawRectangle({
    x: margin + columnWidth + mmToPt(4),
    y: cursorY - blockHeight,
    width: columnWidth,
    height: blockHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });

  drawText(page, 'من / FROM', {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(2),
    font: boldFont,
    size: 9,
  });
  drawText(page, merchant.name, {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(8),
    font: boldFont,
    size: 11,
    maxWidth: columnWidth - mmToPt(4),
  });
  drawText(page, `${merchant.address} - ${merchant.city}`, {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(18),
    font: regularFont,
    size: 9,
    maxWidth: columnWidth - mmToPt(4),
  });
  drawText(page, `☎ ${merchant.phone}`, {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(28),
    font: regularFont,
    size: 9,
  });

  const recipientX = margin + columnWidth + mmToPt(6);
  drawText(page, 'إلى / TO', {
    x: recipientX,
    y: cursorY - mmToPt(2),
    font: boldFont,
    size: 9,
  });
  drawText(page, shipment.customerName, {
    x: recipientX,
    y: cursorY - mmToPt(8),
    font: boldFont,
    size: 11,
    maxWidth: columnWidth - mmToPt(4),
  });
  drawText(page, shipment.shippingAddress, {
    x: recipientX,
    y: cursorY - mmToPt(18),
    font: regularFont,
    size: 9,
    maxWidth: columnWidth - mmToPt(4),
  });
  drawText(page, `${shipment.shippingCity || ''} ${shipment.shippingPostcode || ''}`.trim(), {
    x: recipientX,
    y: cursorY - mmToPt(28),
    font: regularFont,
    size: 9,
    maxWidth: columnWidth - mmToPt(4),
  });
  drawText(page, `☎ ${shipment.customerPhone}`, {
    x: recipientX,
    y: cursorY - mmToPt(34),
    font: regularFont,
    size: 9,
  });

  cursorY -= blockHeight + mmToPt(8);

  // Amount to collect
  const amountBoxHeight = mmToPt(22);
  page.drawRectangle({
    x: margin,
    y: cursorY - amountBoxHeight,
    width: pageWidth - margin * 2,
    height: amountBoxHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });

  drawText(page, 'مبلغ التحصيل / Amount to Collect', {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(2),
    font: regularFont,
    size: 9,
  });
  drawText(page, formatCurrency(amountToCollect), {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(10),
    font: boldFont,
    size: 16,
  });
  drawText(page, `طريقة الدفع: ${paymentLabel}`, {
    x: pageWidth - margin - mmToPt(2),
    y: cursorY - mmToPt(10),
    font: boldFont,
    size: 10,
    align: 'right',
  });

  cursorY -= amountBoxHeight + mmToPt(6);

  // Items
  const itemsBoxHeight = mmToPt(32);
  page.drawRectangle({
    x: margin,
    y: cursorY - itemsBoxHeight,
    width: pageWidth - margin * 2,
    height: itemsBoxHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  drawText(page, 'محتويات الشحنة / Shipment Contents', {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(2),
    font: regularFont,
    size: 9,
  });

  const maxItems = 5;
  normalized.items.slice(0, maxItems).forEach((item: any, index: number) => {
    const lineY = cursorY - mmToPt(8) - index * mmToPt(5);
    const name =
      item?.product?.name || item?.name || item?.product_name || item?.productName || 'منتج';
    const quantity = typeof item?.quantity === 'number' ? item.quantity : 1;
    drawText(page, `${name}`, {
      x: margin + mmToPt(2),
      y: lineY,
      font: regularFont,
      size: 9,
      maxWidth: pageWidth - margin * 2 - mmToPt(40),
    });
    drawText(page, `x${quantity}`, {
      x: pageWidth - margin - mmToPt(4),
      y: lineY,
      font: boldFont,
      size: 9,
      align: 'right',
    });
  });

  cursorY -= itemsBoxHeight + mmToPt(4);

  drawText(page, 'يجب على المندوب التأكد من الهوية والتوقيع عند التسليم.', {
    x: margin,
    y: cursorY,
    font: regularFont,
    size: 8,
    maxWidth: pageWidth - margin * 2,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
