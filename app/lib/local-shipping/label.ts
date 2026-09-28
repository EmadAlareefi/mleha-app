import { promises as fs } from 'node:fs';
import path from 'node:path';

import fontkit from '@pdf-lib/fontkit';
import type { LocalShipment } from '@prisma/client';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { ArabicShaper } from 'arabic-persian-reshaper';
import QRCode from 'qrcode';

import type { LocalShipmentMeta } from './serializer';
import { normalizeOrderItems } from './serializer';
import { fillMissingPins } from './order-shipping-snapshot';
import {
  buildNavigationUrl,
  isRedundantAddressNote,
  isUsableCoordinatePair,
  parseCoordinate,
} from './ship-to-location';

/**
 * 4×6" thermal label for shipments our own agents deliver.
 *
 * Laid out for a courier reading it in a car: district first, then barcode,
 * recipient, a QR that opens navigation to the customer's pin, and a
 * black band when cash must be collected. Black only — thermal printers
 * drop colour.
 */

type LocalLabelArgs = {
  orderNo: string;
  trackingCode: string;
  createdAt: Date;
  itemsCount: number;
  recipientName: string;
  recipientPhone: string | null;
  city: string | null;
  district: string | null;
  addressLines: string[];
  addressNote: string | null;
  mapUrl: string | null;
  codAmountHalalas: number;
  orderTotalHalalas: number;
  paymentMethodLabel: string;
  internalNote: string | null;
};

const PAGE_WIDTH = mmToPt(101.6); // 4 inches
const PAGE_HEIGHT = mmToPt(152.4); // 6 inches
const MARGIN = 12;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GREY = rgb(0.35, 0.35, 0.35);

const FONT_DIRS = [
  process.env.LOCAL_SHIPPING_FONT_DIR,
  path.join(/* turbopackIgnore: true */ process.cwd(), 'public', 'fonts', 'local-shipping'),
  path.join(/* turbopackIgnore: true */ process.cwd(), 'app', 'lib', 'local-shipping', 'fonts'),
].filter((candidate): candidate is string => Boolean(candidate));
const fontCache = new Map<string, Promise<Uint8Array>>();

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
  // Shipments created before the address fix only have the city; fill the rest
  // from the stored Salla order.
  const storedAddress = await fillMissingPins([shipment]);
  const normalized = normalizeOrderItems(storedAddress.get(shipment.id) ?? shipment.orderItems);
  const labelArgs = mapShipmentToLabelArgs(shipment, normalized.meta);
  return buildLocalShipmentLabel(labelArgs, merchant);
}

// ---------------------------------------------------------------------------
// Bidirectional text
// ---------------------------------------------------------------------------

const ARABIC_CHAR = /[\u0600-\u065F\u066A-\u06EF\u06FA-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z0-9]/;

type Run = { text: string; rtl: boolean };

/**
 * Splits a line into Arabic and Latin/number runs. pdf-lib reverses any run it
 * lays out with the Arabic font, so numbers must be drawn as their own runs or
 * "8948" prints as "8498". Neutral characters (spaces, punctuation) join the
 * Latin side only when both neighbours are Latin.
 */
function splitRuns(text: string): Run[] {
  const chars = Array.from(text);
  const strong = chars.map((char) => (ARABIC_CHAR.test(char) ? 'r' : LTR_CHAR.test(char) ? 'l' : 'n'));
  const resolved = strong.map((kind, index) => {
    if (kind !== 'n') return kind;
    let before = 'r';
    for (let i = index - 1; i >= 0; i -= 1) if (strong[i] !== 'n') { before = strong[i]; break; }
    let after = 'r';
    for (let i = index + 1; i < strong.length; i += 1) if (strong[i] !== 'n') { after = strong[i]; break; }
    return before === 'l' && after === 'l' ? 'l' : 'r';
  });

  const runs: Run[] = [];
  chars.forEach((char, index) => {
    const rtl = resolved[index] === 'r';
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.text += char;
    else runs.push({ text: char, rtl });
  });
  return runs;
}

const isRtlText = (text: string) => ARABIC_CHAR.test(text);

/**
 * pdf-lib lays Arabic-Indic digits out right-to-left too ("١٢" → "٢١"), so
 * print them as Western digits, which couriers read just as well.
 */
const toWesternDigits = (value: string) =>
  value
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));

type Fonts = { arabic: PDFFont; latin: PDFFont; latinBold: PDFFont };

type TextStyle = { size: number; bold?: boolean; color?: ReturnType<typeof rgb> };

class TextPainter {
  constructor(private readonly page: PDFPage, private readonly fonts: Fonts) {}

  private pieces(rawText: string, style: TextStyle) {
    const text = toWesternDigits(rawText);
    const rtlParagraph = isRtlText(text);
    const runs = rtlParagraph ? splitRuns(text) : [{ text, rtl: false }];
    return {
      rtlParagraph,
      pieces: runs.map((run) => {
        const font = run.rtl ? this.fonts.arabic : style.bold ? this.fonts.latinBold : this.fonts.latin;
        const shaped = run.rtl ? ArabicShaper.convertArabic(run.text) : run.text;
        return { shaped, font, width: font.widthOfTextAtSize(shaped, style.size), rtl: run.rtl };
      }),
    };
  }

  width(text: string, style: TextStyle) {
    return this.pieces(text, style).pieces.reduce((sum, piece) => sum + piece.width, 0);
  }

  /** Draws one line; `x` is the right edge for 'right', left edge for 'left', centre for 'center'. */
  draw(text: string, x: number, y: number, style: TextStyle, align: 'left' | 'right' | 'center' = 'right') {
    const { rtlParagraph, pieces } = this.pieces(text, style);
    const total = pieces.reduce((sum, piece) => sum + piece.width, 0);
    const left = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    const color = style.color ?? BLACK;

    // Visual order: RTL paragraphs place runs right-to-left.
    let cursor = rtlParagraph ? left + total : left;
    for (const piece of pieces) {
      const drawX = rtlParagraph ? cursor - piece.width : cursor;
      this.page.drawText(piece.shaped, { x: drawX, y, font: piece.font, size: style.size, color });
      // The Arabic font has no bold cut; overprint it slightly offset.
      if (style.bold && piece.rtl) {
        this.page.drawText(piece.shaped, { x: drawX + 0.35, y, font: piece.font, size: style.size, color });
      }
      cursor = rtlParagraph ? drawX : cursor + piece.width;
    }
    return total;
  }

  /** Word-wraps to `maxWidth`, measuring real glyph widths. */
  wrap(text: string, maxWidth: number, style: TextStyle): string[] {
    const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && this.width(candidate, style) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

async function buildLocalShipmentLabel(args: LocalLabelArgs, merchant: MerchantLabelInfo) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const [arabicData, latinData, latinBoldData] = await Promise.all([
    loadFont('NotoNaskhArabic-Regular.ttf'),
    loadFont('DejaVuSans.ttf'),
    loadFont('DejaVuSans-Bold.ttf'),
  ]);
  const fonts: Fonts = {
    arabic: await pdfDoc.embedFont(arabicData, { subset: true }),
    latin: await pdfDoc.embedFont(latinData, { subset: true }),
    latinBold: await pdfDoc.embedFont(latinBoldData, { subset: true }),
  };

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const text = new TextPainter(page, fonts);
  const left = MARGIN;
  const right = PAGE_WIDTH - MARGIN;
  let y = PAGE_HEIGHT - MARGIN;

  // 1. Service bar ----------------------------------------------------------
  const barHeight = 24;
  page.drawRectangle({ x: left, y: y - barHeight, width: CONTENT_WIDTH, height: barHeight, color: BLACK });
  text.draw(`${merchant.name} · توصيل محلي`, right - 8, y - 17, { size: 12, bold: true, color: WHITE });
  text.draw(formatDate(args.createdAt), left + 8, y - 16, { size: 9, color: WHITE }, 'left');
  y -= barHeight;

  // 2. Routing: district (what the courier sorts by) + piece count ---------
  const routeHeight = 44;
  const piecesBoxWidth = 58;
  page.drawRectangle({
    x: left,
    y: y - routeHeight,
    width: CONTENT_WIDTH,
    height: routeHeight,
    borderColor: BLACK,
    borderWidth: 1.2,
  });
  page.drawLine({
    start: { x: left + piecesBoxWidth, y },
    end: { x: left + piecesBoxWidth, y: y - routeHeight },
    thickness: 1.2,
    color: BLACK,
  });
  const routeLabel = args.district ? `حي ${args.district.replace(/^حي\s+/u, '')}` : args.city || '—';
  const routeStyle = fitSize(text, routeLabel, CONTENT_WIDTH - piecesBoxWidth - 16, 20, 12, true);
  text.draw(routeLabel, right - 8, y - 20, routeStyle);
  if (args.district && args.city) {
    text.draw(args.city, right - 8, y - 34, { size: 9, color: GREY });
  }
  text.draw(String(args.itemsCount || 1), left + piecesBoxWidth / 2, y - 21, { size: 18, bold: true }, 'center');
  text.draw(piecesLabel(args.itemsCount || 1), left + piecesBoxWidth / 2, y - 34, { size: 8, color: GREY }, 'center');
  y -= routeHeight + 8;

  // 3. Barcode ---------------------------------------------------------------
  const barcodeHeight = 58;
  drawCode39Barcode(page, args.orderNo, {
    x: left + 6,
    y: y - barcodeHeight,
    width: CONTENT_WIDTH - 12,
    height: barcodeHeight,
    color: BLACK,
  });
  y -= barcodeHeight + 13;
  text.draw(`#${args.orderNo}`, PAGE_WIDTH / 2, y, { size: 13, bold: true }, 'center');
  y -= 10;
  text.draw(args.trackingCode, PAGE_WIDTH / 2, y, { size: 7, color: GREY }, 'center');
  y -= 8;

  // 4. Recipient -------------------------------------------------------------
  const footerTop = MARGIN + 26;
  const paymentHeight = 40;
  const recipientBottomLimit = footerTop + paymentHeight + 8;

  const qrSize = args.mapUrl ? 88 : 0;
  const pad = 8;
  const textRight = right - pad;
  const textWidth = CONTENT_WIDTH - pad * 2 - (qrSize ? qrSize + 8 : 0);

  const nameStyle: TextStyle = { size: 15, bold: true };
  const phoneStyle: TextStyle = { size: 14, bold: true };
  let addressStyle: TextStyle = { size: 12 };
  const noteStyle: TextStyle = { size: 10.5 };

  const layoutRecipient = () => {
    const nameLines = text.wrap(args.recipientName, textWidth, nameStyle).slice(0, 2);
    const addressLines = args.addressLines.flatMap((line) => text.wrap(line, textWidth, addressStyle));
    const noteLines = args.addressNote ? text.wrap(args.addressNote, CONTENT_WIDTH - pad * 2 - 12, noteStyle).slice(0, 3) : [];
    const textHeight =
      12 + nameLines.length * 18 + (args.recipientPhone ? 18 : 0) + addressLines.length * (addressStyle.size + 4);
    const noteHeight = noteLines.length ? 16 + noteLines.length * 13 + 4 : 0;
    const height = Math.max(textHeight, qrSize ? qrSize + 22 : 0) + noteHeight + pad;
    return { nameLines, addressLines, noteLines, height };
  };

  let recipient = layoutRecipient();
  // Long addresses: shrink the address text before letting it collide with payment.
  while (y - recipient.height < recipientBottomLimit && addressStyle.size > 8.5) {
    addressStyle = { size: addressStyle.size - 0.5 };
    recipient = layoutRecipient();
  }
  const maxHeight = y - recipientBottomLimit;
  const boxHeight = Math.min(recipient.height, maxHeight);
  const boxTop = y;
  page.drawRectangle({
    x: left,
    y: boxTop - boxHeight,
    width: CONTENT_WIDTH,
    height: boxHeight,
    borderColor: BLACK,
    borderWidth: 1.2,
  });

  let ty = boxTop - 11;
  text.draw('المستلم', textRight, ty, { size: 7.5, color: GREY });
  ty -= 15;
  for (const line of recipient.nameLines) {
    text.draw(line, textRight, ty, nameStyle);
    ty -= 18;
  }
  if (args.recipientPhone) {
    text.draw(formatPhone(args.recipientPhone), textRight, ty, phoneStyle);
    ty -= 18;
  }
  const lineHeight = addressStyle.size + 4;
  for (const line of recipient.addressLines) {
    if (ty < boxTop - boxHeight + pad) break;
    text.draw(line, textRight, ty, addressStyle);
    ty -= lineHeight;
  }

  if (args.mapUrl && qrSize) {
    const qrX = left + pad;
    const qrTop = boxTop - pad;
    drawQrCode(page, args.mapUrl, qrX, qrTop, qrSize);
    text.draw('امسح للملاحة', qrX + qrSize / 2, qrTop - qrSize - 10, { size: 7.5, bold: true }, 'center');
  }

  if (recipient.noteLines.length) {
    const noteHeight = 12 + recipient.noteLines.length * 13;
    const noteTop = boxTop - boxHeight + pad + noteHeight;
    page.drawRectangle({
      x: left + pad,
      y: noteTop - noteHeight,
      width: CONTENT_WIDTH - pad * 2,
      height: noteHeight,
      borderColor: BLACK,
      borderWidth: 0.8,
      borderDashArray: [3, 2],
    });
    let ny = noteTop - 10;
    text.draw('ملاحظة العميل', right - pad - 6, ny, { size: 7.5, bold: true });
    ny -= 11;
    for (const line of recipient.noteLines) {
      text.draw(line, right - pad - 6, ny, noteStyle);
      ny -= 13;
    }
  }
  y = boxTop - boxHeight - 8;

  // 5. Payment: directly under the recipient; the footer stays at the bottom.
  const paymentTop = y;
  const paymentBottom = paymentTop - paymentHeight;
  const isCod = args.codAmountHalalas > 0;
  if (isCod) {
    page.drawRectangle({ x: left, y: paymentBottom, width: CONTENT_WIDTH, height: paymentHeight, color: BLACK });
    text.draw('تحصيل عند الاستلام', right - 10, paymentTop - 17, { size: 12, bold: true, color: WHITE });
    text.draw('COD', right - 10, paymentTop - 32, { size: 9, bold: true, color: WHITE });
    text.draw(`${formatAmount(args.codAmountHalalas)} SAR`, left + 10, paymentTop - 27, { size: 19, bold: true, color: WHITE }, 'left');
  } else {
    page.drawRectangle({
      x: left,
      y: paymentBottom,
      width: CONTENT_WIDTH,
      height: paymentHeight,
      borderColor: BLACK,
      borderWidth: 1.2,
    });
    text.draw('مدفوع مسبقاً — لا تحصّل أي مبلغ', right - 10, paymentTop - 18, { size: 11.5, bold: true });
    text.draw(
      `${args.paymentMethodLabel} · ${formatAmount(args.orderTotalHalalas)} SAR`,
      right - 10,
      paymentTop - 32,
      { size: 8.5, color: GREY },
    );
  }

  // 6. Sender footer -----------------------------------------------------------
  const senderLine = [`المرسل: ${merchant.name}`, merchant.phone, merchant.address].filter(Boolean).join(' · ');
  const senderStyle = fitSize(text, senderLine, CONTENT_WIDTH, 8, 6, false);
  text.draw(senderLine, right, MARGIN + 13, { ...senderStyle, color: GREY });
  if (args.internalNote) {
    const noteLine = text.wrap(`ملاحظة: ${args.internalNote}`, CONTENT_WIDTH, { size: 7.5 })[0];
    text.draw(noteLine, right, MARGIN + 3, { size: 7.5, color: GREY });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

const piecesLabel = (count: number) =>
  count === 1 ? 'قطعة' : count === 2 ? 'قطعتان' : count <= 10 ? 'قطع' : 'قطعة';

/** Largest size (step 0.5) at which `value` fits in `maxWidth`. */
function fitSize(text: TextPainter, value: string, maxWidth: number, max: number, min: number, bold: boolean): TextStyle {
  let size = max;
  while (size > min && text.width(value, { size, bold }) > maxWidth) size -= 0.5;
  return { size, bold };
}

function drawQrCode(page: PDFPage, value: string, x: number, top: number, size: number) {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const cell = size / count;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.modules.get(row, col)) {
        // Slight overlap avoids hairline gaps between modules on thermal heads.
        page.drawRectangle({ x: x + col * cell, y: top - (row + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: BLACK });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Data mapping
// ---------------------------------------------------------------------------

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  mada: 'مدى',
  credit_card: 'بطاقة ائتمانية',
  tamara: 'تمارا',
  tamara_installment: 'تمارا',
  tabby: 'تابي',
  tabby_installment: 'تابي',
  apple_pay: 'Apple Pay',
  stc_pay: 'STC Pay',
  bank: 'تحويل بنكي',
  paypal: 'PayPal',
  cod: 'الدفع عند الاستلام',
};

const formatPaymentMethod = (value: string | null | undefined, isCod: boolean) => {
  const key = value?.trim().toLowerCase();
  if (key && PAYMENT_METHOD_LABELS[key]) return PAYMENT_METHOD_LABELS[key];
  if (key) return value!.replace(/_/g, ' ');
  return isCod ? 'الدفع عند الاستلام' : 'مدفوع إلكترونياً';
};

function mapShipmentToLabelArgs(shipment: LocalShipment, meta: LocalShipmentMeta): LocalLabelArgs {
  const orderTotal = numberFromUnknown(shipment.orderTotal);
  const collectionAmount = shipment.isCOD ? numberFromUnknown(meta.collectionAmount) || orderTotal : 0;
  const address = buildRecipientAddress(shipment, meta);
  const lat = parseCoordinate(meta.shipToLatitude);
  const lng = parseCoordinate(meta.shipToLongitude);

  return {
    orderNo: shipment.orderNumber,
    trackingCode: shipment.trackingNumber,
    createdAt: shipment.createdAt,
    itemsCount: shipment.itemsCount,
    recipientName: cleanValue(meta.shipToName) ?? shipment.customerName,
    recipientPhone: cleanValue(meta.shipToPhone) ?? cleanValue(shipment.customerPhone),
    city: address.city,
    district: address.district,
    addressLines: address.lines,
    addressNote: address.note,
    mapUrl: isUsableCoordinatePair(lat, lng) ? buildNavigationUrl(lat as number, lng as number) : null,
    codAmountHalalas: toHalalas(collectionAmount),
    orderTotalHalalas: toHalalas(orderTotal),
    paymentMethodLabel: formatPaymentMethod(meta.paymentMethod, shipment.isCOD),
    internalNote: sanitizeCustomerNote(shipment),
  };
}

const MAX_ADDRESS_LINES = 5;
const REGION_CODE_PATTERN = /^[A-Z]{2}$/;
// Filler the create route stores when Salla sent no address.
const PLACEHOLDER_PATTERN = /^(مدينة العميل\s*:.*|لم يتم توفير العنوان)$/u;
// shipToArabicText repeats the recipient's name and phone, which have their own fields.
const CONTACT_LINE_PATTERN = /^(المستلم|Phone|الهاتف)\s*:/iu;

const splitAddressSegments = (value?: string | null) =>
  (value ?? '')
    .split(/\r?\n|[،,]+/u)
    .map((segment) => segment.trim())
    .filter(
      (segment) =>
        segment.length > 0 &&
        !REGION_CODE_PATTERN.test(segment) &&
        !PLACEHOLDER_PATTERN.test(segment) &&
        !CONTACT_LINE_PATTERN.test(segment),
    );

/**
 * Recipient address as a courier reads it. District and city are printed in
 * the routing band; the lines here are street, postal/national codes, and the
 * customer's own note is returned separately (only when it adds information).
 */
// Salla's ship_to.city is often English; the rest of the label is Arabic.
const ARABIC_CITY_NAMES: Array<[RegExp, string]> = [
  [/^(jedd?ah|jiddah|جده)$/i, 'جدة'],
  [/^riyadh$/i, 'الرياض'],
  [/^(makkah|mecca)$/i, 'مكة المكرمة'],
  [/^(al )?(madinah|medina)$/i, 'المدينة المنورة'],
  [/^dammam$/i, 'الدمام'],
  [/^(al )?khobar$/i, 'الخبر'],
  [/^taif$/i, 'الطائف'],
];

const toArabicCity = (value: string | null) => {
  if (!value) return null;
  const match = ARABIC_CITY_NAMES.find(([pattern]) => pattern.test(value.trim()));
  return match ? match[1] : value;
};

export function buildRecipientAddress(shipment: LocalShipment, meta: LocalShipmentMeta) {
  const city = toArabicCity(cleanValue(meta.shipToCity) ?? cleanValue(shipment.shippingCity));
  const district = cleanValue(meta.shipToDistrict)?.replace(/^حي\s+/u, '') ?? null;
  const building = cleanValue(meta.shipToBuildingNumber);
  const skip = new Set([city, district, building].filter((value): value is string => Boolean(value)));

  const lines: string[] = [];
  const push = (value?: string | null) => {
    const cleaned = cleanValue(value);
    if (cleaned && !lines.includes(cleaned)) lines.push(cleaned);
  };

  const street =
    cleanValue(meta.shipToStreet) ??
    (splitAddressSegments(meta.shipToAddressLine)
      .filter((segment) => !skip.has(segment))
      .join(' ') || null);
  push([building ? `مبنى ${building}` : null, street].filter(Boolean).join(' · '));

  const postal = cleanValue(meta.shipToPostalCode) ?? cleanValue(shipment.shippingPostcode);
  const shortAddress = cleanValue(meta.shipToShortAddress);
  if (shortAddress) push(`العنوان الوطني ${shortAddress}`);
  if (postal) push(`الرمز البريدي ${postal}`);

  // Nothing structured: fall back to whatever free text Salla gave us.
  if (!street && !district) {
    [meta.shipToArabicText, shipment.shippingAddress]
      .flatMap(splitAddressSegments)
      .filter((segment) => segment !== city)
      .forEach(push);
  }

  const rawNote = cleanValue(meta.shipToAddressNote);
  const note =
    rawNote && !isRedundantAddressNote(rawNote, [street, district, city, building, shortAddress, postal])
      ? rawNote
      : null;

  return { city, district, lines: lines.slice(0, MAX_ADDRESS_LINES), note };
}

function sanitizeCustomerNote(shipment: LocalShipment): string | null {
  for (const note of [shipment.deliveryNotes, shipment.notes]) {
    const trimmed = typeof note === 'string' ? note.trim() : '';
    if (trimmed) return trimmed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** "+966549512795" → "+966 54 951 2795" so the courier can read it at a glance. */
function formatPhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, '');
  const match = digits.match(/^\+?966(5\d)(\d{3})(\d{4})$/);
  if (match) return `+966 ${match[1]} ${match[2]} ${match[3]}`;
  return value.trim();
}

function formatDate(value: Date): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toHalalas(value: number): number {
  return Math.max(0, Math.round(value * 100));
}

function formatAmount(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

function cleanValue(value?: string | null): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function mmToPt(value: number): number {
  return (value * 72) / 25.4;
}

async function loadFont(filename: string): Promise<Uint8Array> {
  let cached = fontCache.get(filename);
  if (!cached) {
    cached = (async () => {
      for (const dir of FONT_DIRS) {
        try {
          return await fs.readFile(/* turbopackIgnore: true */ path.join(dir, filename));
        } catch {
          // Try the next directory
        }
      }
      throw new Error(`Label font ${filename} not found in: ${FONT_DIRS.join(', ')}`);
    })();
    fontCache.set(filename, cached);
  }
  return cached;
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
