import { promises as fs } from 'node:fs';
import path from 'node:path';

import fontkit from '@pdf-lib/fontkit';
import type { LocalShipment } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import { ArabicShaper } from 'arabic-persian-reshaper';

import type { LocalShipmentMeta } from './serializer';
import { normalizeOrderItems } from './serializer';

type LocalLabelArgs = {
  orderNo: string;
  trackingCode: string;
  recipientName: string;
  recipientPhone?: string | null;
  city?: string | null;
  addressLines: string[];
  codAmountHalalas: number;
  orderTotalHalalas: number;
  paymentMethodLabel: string;
  customerNote?: string | null;
};

type TextDirection = 'rtl' | 'ltr';

const PAGE_WIDTH = mmToPt(101.6); // 4 inches
const PAGE_HEIGHT = mmToPt(152.4); // 6 inches
const PAGE_PADDING = 18;

const FONT_FILENAME = 'NotoNaskhArabic-Regular.ttf';
const FONT_CANDIDATE_PATHS = [
  path.join(process.cwd(), 'public', 'fonts', 'local-shipping', FONT_FILENAME),
  path.join(process.cwd(), 'app', 'lib', 'local-shipping', 'fonts', FONT_FILENAME),
];
let cachedFontData: Promise<Uint8Array> | null = null;

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

export interface MerchantLabelInfo {
  name: string;
  nameEn?: string | null;
  phone: string;
  address: string;
  city: string;
}

export const getMerchantLabelInfo = (): MerchantLabelInfo => ({
  name: process.env.NEXT_PUBLIC_MERCHANT_NAME || 'Local Store',
  nameEn: process.env.NEXT_PUBLIC_MERCHANT_NAME_EN || null,
  phone: process.env.NEXT_PUBLIC_MERCHANT_PHONE || '0500000000',
  address: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || 'Riyadh - Saudi Arabia',
  city: process.env.NEXT_PUBLIC_MERCHANT_CITY || 'Riyadh',
});

export async function generateLocalShipmentLabelPdf(
  shipment: LocalShipment,
  merchant: MerchantLabelInfo = getMerchantLabelInfo(),
) {
  const normalized = normalizeOrderItems(shipment.orderItems);
  const labelArgs = mapShipmentToLabelArgs(shipment, normalized.meta);
  return buildLocalShipmentLabel(labelArgs, merchant);
}

async function buildLocalShipmentLabel(args: LocalLabelArgs, merchant: MerchantLabelInfo) {
  const arabicFontData = await loadArabicFont();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const [arabicFont, latinFont] = await Promise.all([
    pdfDoc.embedFont(arabicFontData, { subset: true }),
    pdfDoc.embedFont(StandardFonts.Helvetica),
  ]);

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const contentLeft = PAGE_PADDING;
  const contentWidth = PAGE_WIDTH - PAGE_PADDING * 2;
  const headerHeight = 80;
  const headerTop = PAGE_HEIGHT - PAGE_PADDING / 2;
  const headerBottom = headerTop - headerHeight;
  const headerX = PAGE_PADDING / 2;
  const headerWidth = PAGE_WIDTH - PAGE_PADDING;
  const headerRight = headerX + headerWidth;

  const textColor = rgb(0.13, 0.15, 0.2);
  const subtleText = rgb(0.46, 0.48, 0.55);
  const accentColor = rgb(0.82, 0.19, 0.32);
  const borderColor = rgb(0.88, 0.9, 0.94);
  const headerBg = rgb(1, 0.97, 0.98);
  const sectionBg = rgb(0.98, 0.99, 1);
  const noteBg = rgb(1, 0.98, 0.94);
  const trackingBg = rgb(0.16, 0.13, 0.26);
  const trackingLabelColor = rgb(0.86, 0.82, 0.95);

  const trackingStatus = 'Local Shipment';
  const senderName = merchant.nameEn || merchant.name || 'Local Merchant';
  const senderAddress = merchant.address || merchant.city || 'Riyadh - Saudi Arabia';
  const senderPhone = merchant.phone || '0500000000';
  const footerLabel =
    process.env.NEXT_PUBLIC_MERCHANT_LABEL_FOOTER ||
    `${merchant.nameEn || merchant.name || 'Local Store'} Local Delivery`;

  const drawDirectionalValue = (
    value: string,
    x: number,
    y: number,
    fontSize: number,
    color = textColor,
    align: 'left' | 'right' = 'right',
    direction?: TextDirection,
  ) => {
    let resolvedDirection = direction ?? detectDirection(value);
    if (resolvedDirection === 'ltr' && /[\u0600-\u06FF]/.test(value)) {
      resolvedDirection = 'rtl';
    }
    const shaped = resolvedDirection === 'rtl' ? ArabicShaper.convertArabic(value) : value;
    const font = resolvedDirection === 'rtl' ? arabicFont : latinFont;
    const width = font.widthOfTextAtSize(shaped, fontSize);
    const drawX = align === 'right' ? x - width : x;
    page.drawText(shaped, {
      x: drawX,
      y,
      font,
      size: fontSize,
      color,
    });
  };

  const drawHeader = () => {
    page.drawRectangle({
      x: headerX,
      y: headerBottom,
      width: headerWidth,
      height: headerHeight,
      color: headerBg,
      borderColor,
      borderWidth: 1,
    });

    drawDirectionalValue(senderName, headerRight - 18, headerTop - 28, 12, accentColor, 'right', 'ltr');
    drawDirectionalValue('Local Delivery Service', headerRight - 18, headerTop - 42, 8.5, subtleText, 'right', 'ltr');

    page.drawText(`Order #${args.orderNo}`, {
      x: headerX + 26,
      y: headerTop - 30,
      font: latinFont,
      size: 10,
      color: textColor,
    });
    page.drawText(senderPhone, {
      x: headerX + 26,
      y: headerTop - 42,
      font: latinFont,
      size: 8,
      color: subtleText,
    });

    const trackingBarX = headerX + 22;
    const trackingBarY = headerBottom + 22;
    const trackingBarWidth = headerWidth - 44;
    const trackingBarHeight = 26;

    page.drawRectangle({
      x: trackingBarX,
      y: trackingBarY,
      width: trackingBarWidth,
      height: trackingBarHeight,
      color: trackingBg,
      borderColor: rgb(0.07, 0.05, 0.12),
      borderWidth: 0.5,
    });

    page.drawText('TRACKING', {
      x: trackingBarX + 10,
      y: trackingBarY + trackingBarHeight - 10,
      font: latinFont,
      size: 7,
      color: trackingLabelColor,
    });
    page.drawText(args.trackingCode, {
      x: trackingBarX + 10,
      y: trackingBarY + 6,
      font: latinFont,
      size: 12,
      color: rgb(1, 1, 1),
    });
    drawDirectionalValue(
      trackingStatus,
      trackingBarX + trackingBarWidth - 10,
      trackingBarY + trackingBarHeight - 12,
      8,
      trackingLabelColor,
      'right',
      'ltr',
    );
  };

  const drawSplitSection = (columns: SectionColumn[]) => {
    if (columns.length === 0) {
      return;
    }
    const blockTop = cursorY;
    const maxRows = Math.max(...columns.map((column) => column.fields.length));
    const rowHeight = 18;
    const paddingTop = 16;
    const paddingBottom = 12;
    const blockHeight = paddingTop + paddingBottom + maxRows * rowHeight;
    const blockBottom = blockTop - blockHeight;

    page.drawRectangle({
      x: contentLeft,
      y: blockBottom,
      width: contentWidth,
      height: blockHeight,
      color: sectionBg,
      borderColor,
      borderWidth: 1,
    });

    const columnGap = columns.length > 1 ? 18 : 0;
    const columnWidth = (contentWidth - columnGap * (columns.length - 1)) / columns.length;

    columns.forEach((column, index) => {
      const colLeft = contentLeft + index * (columnWidth + columnGap);
      const colRight = colLeft + columnWidth - 12;
      let colY = blockTop - 18;
      drawDirectionalValue(column.title, colRight, colY, 10, accentColor, 'right', 'ltr');
      colY -= 10;
      column.fields.forEach((field) => {
        colY -= 2;
        drawDirectionalValue(field.label, colRight, colY, 7.5, subtleText, 'right', 'ltr');
        colY -= 8;
        const values = field.valueLines?.length ? field.valueLines : [ensureValue(field.value)];
        values.forEach((line, valueIndex) => {
          drawDirectionalValue(line, colRight, colY, 9, textColor, 'right', field.direction);
          if (valueIndex < values.length - 1) {
            colY -= 10;
          }
        });
        colY -= rowHeight - 10;
      });
    });

    cursorY = blockBottom - 14;
  };

  const drawPaymentSection = () => {
    const column: SectionColumn = {
      title: 'Payment Details',
      fields: [
        {
          label: 'Order Total',
          value: `${formatAmount(args.orderTotalHalalas)} SAR`,
          direction: 'ltr',
        },
        {
          label: 'Payment Method',
          value: args.paymentMethodLabel,
        },
        {
          label: 'Cash on Delivery',
          value: args.codAmountHalalas > 0 ? `${formatAmount(args.codAmountHalalas)} SAR` : '—',
          direction: 'ltr',
        },
      ],
    };
    drawSplitSection([column]);
  };

  const drawNote = (noteValue: string) => {
    const lines = wrapValue(noteValue, 48);
    if (lines.length === 0) {
      return;
    }
    const lineHeight = 14;
    const paddingTop = 16;
    const paddingBottom = 14;
    const blockHeight = paddingTop + paddingBottom + lines.length * lineHeight;
    const blockBottom = cursorY - blockHeight;

    page.drawRectangle({
      x: contentLeft,
      y: blockBottom,
      width: contentWidth,
      height: blockHeight,
      color: noteBg,
      borderColor,
      borderWidth: 1,
    });

    let lineY = cursorY - 20;
    drawDirectionalValue('Customer Notes', contentLeft + contentWidth - 14, lineY, 9.5, accentColor, 'right', 'ltr');
    lineY -= 12;
    lines.forEach((line) => {
      lineY -= 2;
      drawDirectionalValue(line, contentLeft + contentWidth - 14, lineY, 9.5, textColor);
      lineY -= lineHeight - 2;
    });

    cursorY = blockBottom - 12;
  };

  const drawFooter = () => {
    const footerY = 30;
    page.drawLine({
      start: { x: PAGE_PADDING, y: footerY + 10 },
      end: { x: PAGE_WIDTH - PAGE_PADDING, y: footerY + 10 },
      color: borderColor,
      thickness: 0.8,
    });
    drawDirectionalValue(footerLabel, PAGE_PADDING, footerY - 4, 8, subtleText, 'left');
    drawDirectionalValue('Thank you for shopping with us', PAGE_WIDTH - PAGE_PADDING, footerY - 4, 8, subtleText, 'right', 'ltr');
  };

  drawHeader();

  let cursorY = headerBottom - 14;
  const barcodeHeight = 36;
  const barcodeBottom = cursorY - barcodeHeight;
  drawCode39Barcode(page, args.orderNo, {
    x: contentLeft,
    y: barcodeBottom,
    width: contentWidth,
    height: barcodeHeight,
    color: textColor,
  });
  page.drawText(args.orderNo, {
    x: contentLeft,
    y: barcodeBottom - 12,
    font: latinFont,
    size: 10,
    color: textColor,
  });
  cursorY = barcodeBottom - 24;

  const senderAddressLines = formatArabicAddressLines(senderAddress, 24);
  const recipientAddressLines = formatRecipientAddressLines(args.addressLines, 22);

  drawSplitSection([
    {
      title: 'Sender',
      fields: [
        { label: 'Business Name', value: senderName, direction: 'ltr' },
        { label: 'Phone', value: senderPhone, direction: 'ltr' },
        { label: 'Address', valueLines: senderAddressLines, direction: 'rtl' },
      ],
    },
    {
      title: 'Recipient',
      fields: [
        { label: 'Name', value: args.recipientName, direction: detectDirection(args.recipientName) },
        { label: 'Phone', value: args.recipientPhone ?? '-', direction: 'ltr' },
        { label: 'City', value: args.city },
        { label: 'Address', valueLines: recipientAddressLines, direction: 'rtl' },
      ],
    },
  ]);

  drawPaymentSection();

  const note = cleanValue(args.customerNote);
  if (note) {
    drawNote(note);
  }

  drawFooter();

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

type SectionField = {
  label: string;
  value?: string | null;
  valueLines?: string[];
  direction?: TextDirection;
};

type SectionColumn = {
  title: string;
  fields: SectionField[];
};

function mapShipmentToLabelArgs(shipment: LocalShipment, meta: LocalShipmentMeta): LocalLabelArgs {
  const orderTotal = numberFromUnknown(shipment.orderTotal);
  const collectionAmount = shipment.isCOD
    ? numberFromUnknown(meta.collectionAmount) || orderTotal
    : 0;
  const paymentMethodLabel =
    meta.paymentMethod || (shipment.isCOD ? 'Cash on Delivery' : 'Paid Online');

  return {
    orderNo: shipment.orderNumber,
    trackingCode: shipment.trackingNumber,
    recipientName: meta.shipToName || shipment.customerName,
    recipientPhone: meta.shipToPhone || shipment.customerPhone,
    city: meta.shipToCity || shipment.shippingCity,
    addressLines: buildRecipientAddressLines(shipment, meta),
    codAmountHalalas: toHalalas(collectionAmount),
    orderTotalHalalas: toHalalas(orderTotal),
    paymentMethodLabel,
    customerNote: sanitizeCustomerNote(shipment),
  };
}

function buildRecipientAddressLines(shipment: LocalShipment, meta: LocalShipmentMeta): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  const pushSegments = (value?: string | null) => {
    if (!value) {
      return;
    }
    value
      .split(/\r?\n/)
      .map((segment) => segment.split(/[،,]+/))
      .forEach((segments) => {
        segments
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0)
          .forEach((segment) => {
            if (!seen.has(segment)) {
              seen.add(segment);
              lines.push(segment);
            }
          });
      });
  };

  pushSegments(meta.shipToArabicText);
  pushSegments(meta.shipToAddressLine);
  pushSegments(shipment.shippingAddress);
  pushSegments(meta.shipToDistrict);

  const cityParts = [meta.shipToCity || shipment.shippingCity, meta.shipToPostalCode || shipment.shippingPostcode].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  if (cityParts.length > 0) {
    pushSegments(cityParts.join(' '));
  }

  return lines;
}

function sanitizeCustomerNote(shipment: LocalShipment): string | null {
  const candidates = [shipment.deliveryNotes, shipment.notes];
  for (const note of candidates) {
    if (typeof note === 'string') {
      const trimmed = note.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof (value as { toString?: () => string }).toString === 'function') {
    const parsed = Number((value as { toString: () => string }).toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toHalalas(value: number): number {
  return Math.max(0, Math.round(value * 100));
}

function detectDirection(value?: string | null): TextDirection {
  if (!value) {
    return 'rtl';
  }
  return /[\u0600-\u06FF]/.test(value) ? 'rtl' : 'ltr';
}

function ensureValue(value?: string | null): string {
  return cleanValue(value) ?? '—';
}

function cleanValue(value?: string | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatArabicAddressLines(value: string, maxChars: number): string[] {
  const segments = value
    .split(/[،,]+/g)
    .map((segment) => cleanValue(segment))
    .filter((segment): segment is string => Boolean(segment));
  const lines: string[] = [];
  segments.forEach((segment) => {
    const wrapped = wrapValue(segment, maxChars);
    if (wrapped.length > 0) {
      lines.push(...wrapped);
    }
  });
  return lines.length > 0 ? lines : ['—'];
}

function formatRecipientAddressLines(linesSource: string[], maxChars: number): string[] {
  const normalized = linesSource
    .map((line) => cleanValue(line))
    .filter((line): line is string => Boolean(line));
  const result: string[] = [];
  normalized.forEach((line) => {
    const wrapped = wrapValue(line, maxChars);
    if (wrapped.length > 0) {
      result.push(...wrapped);
    }
  });
  return result.length > 0 ? result : ['—'];
}

function wrapValue(value: string, maxChars: number): string[] {
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return [];
  }
  const words = cleaned.replace(/\s+/g, ' ').split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current.length > 0) {
        lines.push(current);
        current = word;
      } else {
        lines.push(word);
        current = '';
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function formatAmount(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

function mmToPt(value: number): number {
  return (value * 72) / 25.4;
}

async function loadArabicFont(): Promise<Uint8Array> {
  if (!cachedFontData) {
    cachedFontData = (async () => {
      for (const candidate of FONT_CANDIDATE_PATHS) {
        try {
          return await fs.readFile(candidate);
        } catch {
          // Ignore and try the next candidate
        }
      }
      throw new Error(`Arabic font not found. Expected one of: ${FONT_CANDIDATE_PATHS.join(', ')}`);
    })();
  }
  return cachedFontData;
}

function drawCode39Barcode(
  page: PDFPage,
  value: string,
  opts: { x: number; y: number; width: number; height: number; color?: ReturnType<typeof rgb> },
) {
  const normalizedValue = `*${sanitizeCode39Value(value)}*`;
  const modules: Array<{ type: 'bar' | 'space'; units: number }> = [];
  let totalUnits = 0;

  normalizedValue.split('').forEach((char) => {
    const pattern = CODE39_PATTERNS[char] || CODE39_PATTERNS['-'];
    for (let index = 0; index < pattern.length; index += 1) {
      const type: 'bar' | 'space' = index % 2 === 0 ? 'bar' : 'space';
      const units = pattern[index] === 'w' ? 3 : 1;
      modules.push({ type, units });
      totalUnits += units;
    }
    modules.push({ type: 'space', units: 1 });
    totalUnits += 1;
  });

  modules.pop();
  totalUnits -= 1;
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
}

function sanitizeCode39Value(value: string): string {
  if (!value) {
    return '-';
  }
  return value
    .toUpperCase()
    .split('')
    .map((char) => (CODE39_PATTERNS[char] ? char : '-'))
    .join('');
}
