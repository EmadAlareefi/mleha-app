import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
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

const loadFontBytes = (fileName: string): Buffer | null => {
  const searchPaths = [
    path.join(process.cwd(), 'public', 'fonts', 'local-shipping', fileName),
    path.join(process.cwd(), 'app', 'lib', 'local-shipping', 'fonts', fileName),
  ];
  for (const candidate of searchPaths) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate);
      }
    } catch (error) {
      console.error('[local-shipping][label] Failed to load font from', candidate, error);
    }
  }
  console.warn('[local-shipping][label] Arabic font not found for', fileName);
  return null;
};

const arabicFontCache = {
  regular: null as Buffer | null,
  bold: null as Buffer | null,
};

const getArabicFontBytes = () => {
  if (!arabicFontCache.regular) {
    arabicFontCache.regular = loadFontBytes('DejaVuSans.ttf');
  }
  if (!arabicFontCache.bold) {
    arabicFontCache.bold = loadFontBytes('DejaVuSans-Bold.ttf');
  }
  return arabicFontCache;
};

const formatCurrency = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat('en-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${safe.toFixed(2)} SAR`;
  }
};

const ARABIC_CHAR_REGEX = /[\u0600-\u06FF]/;
const ARABIC_TO_LATIN: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j',
  ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q',
  ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'w', ي: 'y', ء: '',
  ئ: 'y', ة: 'h', ى: 'a', ؤ: 'w', '،': ',', '؛': ';', '؟': '?',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  'ْ': '', 'ٌ': '', 'ٍ': '', 'ً': '', 'ُ': '', 'ِ': '', 'َ': '', 'ّ': '', 'ـ': '',
};

const safeText = (text: string): string => {
  if (!text) return '';
  const normalized = text.toString().trim();
  if (!normalized) return normalized;
  if (!ARABIC_CHAR_REGEX.test(normalized)) return normalized;
  const transliterated = normalized
    .split('')
    .map((char) => ARABIC_TO_LATIN[char] ?? char)
    .join('');
  return transliterated
    .split('')
    .map((char) => (char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126 ? char : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
};

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
    allowArabic?: boolean;
  },
) => {
  const {
    x,
    y,
    font,
    size,
    color = rgb(0, 0, 0),
    maxWidth,
    lineHeight = size + 2,
    align = 'left',
    allowArabic = false,
  } = options;
  const rawText = typeof text === 'string' ? text : text != null ? String(text) : '';
  const normalizedText = allowArabic ? rawText.trim() : safeText(rawText);
  if (!normalizedText) {
    return 0;
  }

  if (!maxWidth) {
    const width = font.widthOfTextAtSize(normalizedText, size);
    const targetX = align === 'right' ? x - width : x;
    page.drawText(normalizedText, { x: targetX, y, size, font, color });
    return lineHeight;
  }

  const paragraphs: string[] = allowArabic ? normalizedText.split(/\r?\n/) : [normalizedText];
  const lines: string[] = [];
  paragraphs.forEach((paragraph: string) => {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      return;
    }
    wrapText(trimmed, font, size, maxWidth).forEach((line) => lines.push(line));
  });

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

const convertArabicIndicDigits = (value: string) =>
  value
    ? value.replace(/[\u0660-\u0669]/g, (char) =>
        String.fromCharCode(char.charCodeAt(0) - 0x0660 + 48),
      )
    : '';

const drawCode39Barcode = (
  page: PDFPage,
  value: string,
  opts: { x: number; y: number; width: number; height: number; color?: RGB },
) => {
  const asciiValue = convertArabicIndicDigits(
    value
      .toString()
      .split('')
      .map((char) => ARABIC_TO_LATIN[char] ?? char)
      .join(''),
  );
  const normalizedValue = asciiValue || '0';
  const sanitized = `*${normalizedValue
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
  name: process.env.NEXT_PUBLIC_MERCHANT_NAME || 'Local Store',
  phone: process.env.NEXT_PUBLIC_MERCHANT_PHONE || '0500000000',
  address: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || 'Riyadh - Saudi Arabia',
  city: process.env.NEXT_PUBLIC_MERCHANT_CITY || 'Riyadh',
});

export async function generateLocalShipmentLabelPdf(
  shipment: LocalShipment,
  merchant: MerchantLabelInfo = getMerchantLabelInfo(),
) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const pageWidth = mmToPt(LABEL_WIDTH_MM);
  const pageHeight = mmToPt(LABEL_HEIGHT_MM);
  const margin = mmToPt(PAGE_MARGIN_MM);

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const { regular: arabicRegularBytes, bold: arabicBoldBytes } = getArabicFontBytes();
  const hasArabicFont = Boolean(arabicRegularBytes && arabicBoldBytes);
  const arabicRegularFont = hasArabicFont
    ? await pdfDoc.embedFont(arabicRegularBytes as Buffer)
    : regularFont;
  const arabicBoldFont = hasArabicFont
    ? await pdfDoc.embedFont(arabicBoldBytes as Buffer)
    : boldFont;

  const normalized = normalizeOrderItems(shipment.orderItems);
  const amountToCollectRaw = normalized.meta.collectionAmount ?? Number(shipment.orderTotal);
  const amountToCollect = shipment.isCOD ? amountToCollectRaw : 0;
  const paymentLabel = normalized.meta.paymentMethod || (shipment.isCOD ? 'Cash On Delivery' : 'Prepaid');
  const createdDate = new Date(shipment.createdAt).toLocaleDateString('en-GB');
  const shipToArabicText =
    typeof normalized.meta.shipToArabicText === 'string' ? normalized.meta.shipToArabicText : null;
  const messengerCourierLabel =
    typeof normalized.meta.messengerCourierLabel === 'string'
      ? normalized.meta.messengerCourierLabel
      : null;

  const orderDateArabic = new Date(shipment.createdAt).toLocaleDateString('ar-SA');

  let cursorY = pageHeight - margin;

  drawText(page, `${merchant.name} - شحن محلي`, {
    x: margin,
    y: cursorY,
    font: arabicBoldFont,
    size: 13,
    allowArabic: hasArabicFont,
  });
  drawText(page, `تاريخ الطلب: ${orderDateArabic}`, {
    x: margin,
    y: cursorY - mmToPt(6),
    font: arabicRegularFont,
    size: 9,
    allowArabic: hasArabicFont,
  });
  drawText(page, `Order Date: ${createdDate}`, {
    x: pageWidth - margin,
    y: cursorY - mmToPt(6),
    font: regularFont,
    size: 8,
    align: 'right',
  });

  cursorY -= mmToPt(14);

  drawText(page, 'رقم الشحنة / Tracking', {
    x: margin,
    y: cursorY,
    font: arabicRegularFont,
    size: 9,
    allowArabic: hasArabicFont,
  });
  drawText(page, shipment.trackingNumber, {
    x: margin,
    y: cursorY - mmToPt(6),
    font: boldFont,
    size: 18,
  });
  cursorY -= mmToPt(16);

  const barcodeHeight = mmToPt(22);
  drawCode39Barcode(page, shipment.orderNumber, {
    x: margin,
    y: cursorY - barcodeHeight,
    width: pageWidth - margin * 2,
    height: barcodeHeight,
  });
  cursorY -= barcodeHeight + mmToPt(4);

  drawText(page, `رقم الطلب: ${shipment.orderNumber}`, {
    x: margin,
    y: cursorY,
    font: arabicRegularFont,
    size: 10,
    allowArabic: hasArabicFont,
  });
  drawText(page, `عدد القطع: ${shipment.itemsCount}`, {
    x: pageWidth - margin,
    y: cursorY,
    font: arabicRegularFont,
    size: 10,
    align: 'right',
    allowArabic: hasArabicFont,
  });

  cursorY -= mmToPt(8);

  // Addresses
  const columnWidth = (pageWidth - margin * 2 - mmToPt(4)) / 2;
  const baseBlockHeight = shipToArabicText ? 48 : 38;
  const blockHeight = mmToPt(baseBlockHeight);

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

  drawText(page, 'المرسل', {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(1),
    font: hasArabicFont ? arabicBoldFont : boldFont,
    size: 10,
    allowArabic: hasArabicFont,
  });
  drawText(page, merchant.name, {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(7),
    font: hasArabicFont ? arabicBoldFont : boldFont,
    size: 11,
    maxWidth: columnWidth - mmToPt(4),
    allowArabic: hasArabicFont,
  });
  drawText(page, `${merchant.address} - ${merchant.city}`, {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(17),
    font: arabicRegularFont,
    size: 9,
    maxWidth: columnWidth - mmToPt(4),
    allowArabic: hasArabicFont,
  });
  drawText(page, `هاتف: ${merchant.phone}`, {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(27),
    font: arabicRegularFont,
    size: 9,
    allowArabic: hasArabicFont,
  });

  const recipientX = margin + columnWidth + mmToPt(6);
  drawText(page, 'المستلم', {
    x: recipientX,
    y: cursorY - mmToPt(1),
    font: hasArabicFont ? arabicBoldFont : boldFont,
    size: 10,
    allowArabic: hasArabicFont,
  });
  drawText(page, shipment.customerName, {
    x: recipientX,
    y: cursorY - mmToPt(7),
    font: arabicBoldFont,
    size: 11,
    maxWidth: columnWidth - mmToPt(4),
    allowArabic: hasArabicFont,
  });
  drawText(page, shipment.shippingAddress, {
    x: recipientX,
    y: cursorY - mmToPt(17),
    font: arabicRegularFont,
    size: 9,
    maxWidth: columnWidth - mmToPt(4),
    allowArabic: hasArabicFont,
  });
  drawText(page, `${shipment.shippingCity || ''} ${shipment.shippingPostcode || ''}`.trim(), {
    x: recipientX,
    y: cursorY - mmToPt(25),
    font: arabicRegularFont,
    size: 9,
    maxWidth: columnWidth - mmToPt(4),
    allowArabic: hasArabicFont,
  });
  drawText(page, `هاتف: ${shipment.customerPhone}`, {
    x: recipientX,
    y: cursorY - mmToPt(31),
    font: arabicRegularFont,
    size: 9,
    allowArabic: hasArabicFont,
  });

  let toBlockY = cursorY - mmToPt(33);
  if (messengerCourierLabel) {
    drawText(page, `شركة سلة: ${messengerCourierLabel}`, {
      x: recipientX,
      y: toBlockY,
      font: arabicRegularFont,
      size: 8,
      maxWidth: columnWidth - mmToPt(4),
      allowArabic: hasArabicFont,
    });
    toBlockY -= mmToPt(5);
  }
  if (shipToArabicText) {
    drawText(page, 'تفاصيل العنوان (سلة):', {
      x: recipientX,
      y: toBlockY,
      font: arabicBoldFont,
      size: 8,
      maxWidth: columnWidth - mmToPt(4),
      allowArabic: hasArabicFont,
    });
    toBlockY -= mmToPt(5);
    drawText(page, shipToArabicText, {
      x: recipientX,
      y: toBlockY,
      font: arabicRegularFont,
      size: 8,
      maxWidth: columnWidth - mmToPt(4),
      lineHeight: 9,
      allowArabic: hasArabicFont,
    });
  }

  cursorY -= blockHeight + mmToPt(6);

  // Amount to collect
  const amountBoxHeight = mmToPt(20);
  page.drawRectangle({
    x: margin,
    y: cursorY - amountBoxHeight,
    width: pageWidth - margin * 2,
    height: amountBoxHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });

  drawText(page, 'مبلغ التحصيل (SAR)', {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(1),
    font: hasArabicFont ? arabicRegularFont : regularFont,
    size: 9,
    allowArabic: hasArabicFont,
  });
  drawText(page, formatCurrency(amountToCollect), {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(8),
    font: boldFont,
    size: 16,
  });
  drawText(page, `طريقة الدفع: ${paymentLabel}`, {
    x: pageWidth - margin - mmToPt(2),
    y: cursorY - mmToPt(8),
    font: hasArabicFont ? arabicBoldFont : boldFont,
    size: 9,
    align: 'right',
    allowArabic: hasArabicFont,
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
  drawText(page, 'محتويات الشحنة', {
    x: margin + mmToPt(2),
    y: cursorY - mmToPt(1),
    font: hasArabicFont ? arabicRegularFont : regularFont,
    size: 9,
    allowArabic: hasArabicFont,
  });

  const maxItems = 5;
  normalized.items.slice(0, maxItems).forEach((item: any, index: number) => {
    const lineY = cursorY - mmToPt(8) - index * mmToPt(5);
    const name =
      item?.product?.name || item?.name || item?.product_name || item?.productName || 'Product';
    const quantity = typeof item?.quantity === 'number' ? item.quantity : 1;
    drawText(page, `${name}`, {
      x: margin + mmToPt(2),
      y: lineY,
      font: hasArabicFont ? arabicRegularFont : regularFont,
      size: 9,
      maxWidth: pageWidth - margin * 2 - mmToPt(40),
      allowArabic: hasArabicFont,
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

  drawText(page, 'يجب على المندوب التحقق من هوية المستلم والحصول على توقيعه عند التسليم.', {
    x: margin,
    y: cursorY,
    font: hasArabicFont ? arabicRegularFont : regularFont,
    size: 8,
    maxWidth: pageWidth - margin * 2,
    allowArabic: hasArabicFont,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
