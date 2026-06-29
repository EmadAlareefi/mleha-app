import { promises as fs } from 'node:fs';
import path from 'node:path';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { ArabicShaper } from 'arabic-persian-reshaper';

import type { SallaOrder, SallaOrderItem } from './salla-api';
import { encodeQr } from './qr';

// ---------------------------------------------------------------------------
// Page / theme constants (A4, RTL Arabic tax invoice modelled on the Salla
// "فاتورة ضريبية" template).
// ---------------------------------------------------------------------------
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const CONTENT_LEFT = MARGIN;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;

const COLOR_TEXT = rgb(0.13, 0.15, 0.2);
const COLOR_MUTED = rgb(0.46, 0.48, 0.55);
const COLOR_ACCENT = rgb(0.18, 0.45, 0.4); // Salla-ish teal/green
const COLOR_BORDER = rgb(0.85, 0.87, 0.9);
const COLOR_HEADER_BG = rgb(0.95, 0.97, 0.96);
const COLOR_TABLE_HEAD = rgb(0.18, 0.45, 0.4);
const COLOR_ZEBRA = rgb(0.97, 0.98, 0.98);
const WHITE = rgb(1, 1, 1);

const ARABIC_FONT_FILENAME = 'NotoNaskhArabic-Regular.ttf';
const ARABIC_FONT_CANDIDATES = [
  process.env.LOCAL_SHIPPING_ARABIC_FONT_PATH,
  path.join(process.cwd(), 'public', 'fonts', 'local-shipping', ARABIC_FONT_FILENAME),
  path.join(process.cwd(), 'app', 'lib', 'local-shipping', 'fonts', ARABIC_FONT_FILENAME),
].filter((c): c is string => Boolean(c));

let cachedArabicFont: Promise<Uint8Array> | null = null;
let cachedLogo: Promise<Uint8Array | null> | null = null;

// ---------------------------------------------------------------------------
// Seller (static company details — overridable through env). Matches the
// values printed on the reference template.
// ---------------------------------------------------------------------------
export interface SellerInfo {
  nameAr: string;
  nameEn: string;
  vatNumber: string;
  crNumber: string;
  addressAr: string;
  phone: string;
  email: string;
}

export function getSellerInfo(): SellerInfo {
  return {
    nameAr: process.env.INVOICE_SELLER_NAME_AR || 'شركة مليحة التجارية',
    nameEn: process.env.INVOICE_SELLER_NAME_EN || 'Maliha Trading Company',
    vatNumber: process.env.INVOICE_SELLER_VAT || '311273037100003',
    crNumber: process.env.INVOICE_SELLER_CR || '268287708',
    addressAr:
      process.env.INVOICE_SELLER_ADDRESS_AR ||
      'حلب، البغدادية الغربية، جدة 22234، المملكة العربية السعودية',
    phone: process.env.INVOICE_SELLER_PHONE || '+966531349631',
    email: process.env.INVOICE_SELLER_EMAIL || 'info@mleha.com',
  };
}

// ---------------------------------------------------------------------------
// Normalised invoice model fed to the renderer.
// ---------------------------------------------------------------------------
export interface InvoiceLineItem {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number; // price excluding VAT, per the whole line
  taxPercent: number;
  taxAmount: number;
  total: number; // line total including VAT
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceType: string; // e.g. "فاتورة ضريبية"
  date: string; // formatted YYYY-MM-DD
  orderNumber: string;
  orderId: string;
  paymentMethod: string;
  currency: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  buyerAddress: string;
  items: InvoiceLineItem[];
  subtotal: number;
  shipping: number;
  codFee: number;
  discount: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Helpers for pulling figures out of the loose Salla JSON shapes.
// ---------------------------------------------------------------------------
type AnyRecord = Record<string, unknown>;

function amountOf(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === 'object') {
    const r = value as AnyRecord;
    if ('amount' in r) return amountOf(r.amount);
    if ('value' in r) return amountOf(r.value);
  }
  return 0;
}

function str(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function formatMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * Builds the normalised invoice model from a Salla order plus (optionally) its
 * tax-invoice record. The order supplies line items and customer details; the
 * invoice supplies the official number, date and tax totals. When no invoice
 * record exists we fall back to deriving totals from the order items.
 */
export function buildInvoiceData(order: SallaOrder, invoice: AnyRecord | null): InvoiceData {
  const orderAny = order as unknown as AnyRecord;
  const items: InvoiceLineItem[] = (order.items || []).map((item: SallaOrderItem) => {
    const a = (item.amounts || {}) as AnyRecord;
    const taxNode = (a.tax || {}) as AnyRecord;
    return {
      name: item.name || str((item.product as AnyRecord | undefined)?.name) || '—',
      sku: item.sku || str((item.product as AnyRecord | undefined)?.sku),
      quantity: Number(item.quantity) || 1,
      unitPrice: amountOf(a.price_without_tax),
      taxPercent: Number(str(taxNode.percent)) || 0,
      taxAmount: amountOf(taxNode.amount),
      total: amountOf(a.total),
    };
  });

  const customer = order.customer || ({} as SallaOrder['customer']);
  const buyerName =
    customer.full_name ||
    customer.name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() ||
    'عميل';

  // Resolve a human shipping address from whatever the order carries.
  const ship =
    (orderAny.ship_to as AnyRecord | undefined) ||
    (orderAny.shipping as AnyRecord | undefined)?.['address'] ||
    (orderAny.shipping as AnyRecord | undefined) ||
    {};
  const shipAny = ship as AnyRecord;
  const addressParts = [
    str(shipAny.address_line) || str(shipAny.shipping_address) || str(shipAny.street_address),
    str(shipAny.block) && `حي ${str(shipAny.block)}`,
    str(shipAny.district),
    str(shipAny.city) || str(customer.city),
    str(shipAny.postal_code) || str(shipAny.postcode),
    str(shipAny.country),
  ].filter((p): p is string => Boolean(p && p.trim()));
  const buyerAddress = addressParts.join('، ') || str(customer.city) || '—';

  // Invoice-level figures (prefer the official invoice record).
  const inv = invoice || {};
  const taxNode = (inv.tax || {}) as AnyRecord;
  const itemsSubtotal = items.reduce((s, i) => s + i.unitPrice, 0);
  const itemsTax = items.reduce((s, i) => s + i.taxAmount, 0);
  const itemsTotal = items.reduce((s, i) => s + i.total, 0);

  const subtotal = invoice ? amountOf(inv.sub_total) : itemsSubtotal;
  const shipping = amountOf(inv.shipping_cost);
  const codFee = amountOf(inv.cod_cost);
  const discount = amountOf(inv.discount);
  const taxAmount = invoice ? amountOf(taxNode.amount) : itemsTax;
  const taxPercent = Number(str(taxNode.percent)) || items[0]?.taxPercent || 15;
  const total = invoice ? amountOf(inv.total) : itemsTotal;

  const dateRaw = str(inv.date) || str((order.date as AnyRecord | undefined)?.created);
  const date = dateRaw ? dateRaw.slice(0, 10) : new Date().toISOString().slice(0, 10);

  return {
    invoiceNumber: str(inv.invoice_number) || str(inv.id) || str(order.reference_id) || str(order.id),
    invoiceType: str(inv.type) || 'فاتورة ضريبية',
    date,
    orderNumber: str(order.reference_id) || str(order.order_number) || str(order.id),
    orderId: str(order.id),
    paymentMethod: translatePaymentMethod(str(inv.payment_method) || str(orderAny.payment_method)),
    currency: items[0] ? str((order.items[0].amounts.total as AnyRecord).currency) || 'SAR' : 'SAR',
    buyerName,
    buyerPhone: str(customer.mobile),
    buyerEmail: str(customer.email),
    buyerAddress,
    items,
    subtotal,
    shipping,
    codFee,
    discount,
    taxPercent,
    taxAmount,
    total,
  };
}

function translatePaymentMethod(method: string): string {
  const m = method.toLowerCase();
  if (m === 'cod' || m.includes('cash')) return 'الدفع عند الاستلام';
  if (m.includes('credit') || m.includes('card') || m === 'mada') return 'بطاقة';
  if (m.includes('apple')) return 'Apple Pay';
  if (m.includes('bank')) return 'تحويل بنكي';
  return method || '—';
}

// ---------------------------------------------------------------------------
// ZATCA Phase-1 QR (Base64 TLV).
// ---------------------------------------------------------------------------
function buildZatcaQrPayload(seller: SellerInfo, data: InvoiceData): string {
  const enc = new TextEncoder();
  const tlv = (tag: number, value: string): number[] => {
    const bytes = Array.from(enc.encode(value));
    return [tag, bytes.length, ...bytes];
  };
  const timestamp = `${data.date}T00:00:00Z`;
  const bytes = [
    ...tlv(1, seller.nameAr),
    ...tlv(2, seller.vatNumber),
    ...tlv(3, timestamp),
    ...tlv(4, formatMoney(data.total)),
    ...tlv(5, formatMoney(data.taxAmount)),
  ];
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return Buffer.from(binary, 'binary').toString('base64');
}

// ---------------------------------------------------------------------------
// Asset loading.
// ---------------------------------------------------------------------------
async function loadArabicFont(): Promise<Uint8Array> {
  if (!cachedArabicFont) {
    cachedArabicFont = (async () => {
      for (const candidate of ARABIC_FONT_CANDIDATES) {
        try {
          return await fs.readFile(candidate);
        } catch {
          // try next
        }
      }
      throw new Error(`Arabic font not found. Tried: ${ARABIC_FONT_CANDIDATES.join(', ')}`);
    })();
  }
  return cachedArabicFont;
}

async function loadLogo(): Promise<Uint8Array | null> {
  if (!cachedLogo) {
    cachedLogo = (async () => {
      try {
        return await fs.readFile(path.join(process.cwd(), 'public', 'logo.png'));
      } catch {
        return null;
      }
    })();
  }
  return cachedLogo;
}

// ---------------------------------------------------------------------------
// Renderer.
// ---------------------------------------------------------------------------
export async function generateSallaInvoicePdf(
  data: InvoiceData,
  seller: SellerInfo = getSellerInfo(),
): Promise<Buffer> {
  const arabicFontData = await loadArabicFont();
  const logoData = await loadLogo();

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const [arabicFont, latinFont, latinBold] = await Promise.all([
    pdf.embedFont(arabicFontData, { subset: true }),
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
  ]);
  let logo: PDFImage | null = null;
  if (logoData) {
    try {
      logo = await pdf.embedPng(logoData);
    } catch {
      logo = null;
    }
  }

  const ctx: RenderCtx = {
    pdf,
    arabicFont,
    latinFont,
    latinBold,
    logo,
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
  };

  drawHeader(ctx, seller, data);
  let cursorY = PAGE_HEIGHT - 150;
  cursorY = drawParties(ctx, seller, data, cursorY);
  cursorY = drawItemsTable(ctx, data, cursorY);
  cursorY = drawTotals(ctx, data, cursorY);
  drawQrAndFooter(ctx, seller, data, cursorY);

  drawTermsPage(ctx, seller);

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

interface RenderCtx {
  pdf: PDFDocument;
  arabicFont: PDFFont;
  latinFont: PDFFont;
  latinBold: PDFFont;
  logo: PDFImage | null;
  page: PDFPage;
}

const ARABIC_RE = /[؀-ۿ]/;

function isArabic(value: string): boolean {
  return ARABIC_RE.test(value);
}

function shape(value: string): string {
  return isArabic(value) ? ArabicShaper.convertArabic(value) : value;
}

/**
 * Draws a string. `align` controls horizontal anchoring at `x`. Arabic text is
 * shaped and rendered with the Arabic font; everything else uses Helvetica.
 */
function draw(
  ctx: RenderCtx,
  text: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    color?: ReturnType<typeof rgb>;
    align?: 'left' | 'right' | 'center';
    bold?: boolean;
    font?: 'auto' | 'latin';
  } = {},
): void {
  const size = opts.size ?? 9;
  const color = opts.color ?? COLOR_TEXT;
  const align = opts.align ?? 'left';
  const useArabic = opts.font !== 'latin' && isArabic(text);
  const font = useArabic ? ctx.arabicFont : opts.bold ? ctx.latinBold : ctx.latinFont;
  const shaped = useArabic ? shape(text) : text;
  const width = font.widthOfTextAtSize(shaped, size);
  let drawX = x;
  if (align === 'right') drawX = x - width;
  else if (align === 'center') drawX = x - width / 2;
  ctx.page.drawText(shaped, { x: drawX, y, font, size, color });
}

function drawHeader(ctx: RenderCtx, seller: SellerInfo, data: InvoiceData): void {
  const { page } = ctx;
  const top = PAGE_HEIGHT - MARGIN;
  const bandHeight = 96;

  page.drawRectangle({
    x: CONTENT_LEFT,
    y: top - bandHeight,
    width: CONTENT_WIDTH,
    height: bandHeight,
    color: COLOR_HEADER_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  // Logo (left) — scaled to fit.
  if (ctx.logo) {
    const maxH = 48;
    const scale = maxH / ctx.logo.height;
    const w = ctx.logo.width * scale;
    page.drawImage(ctx.logo, {
      x: CONTENT_LEFT + 16,
      y: top - 16 - maxH,
      width: w,
      height: maxH,
    });
  }

  // Seller block (right, Arabic).
  const rightX = CONTENT_RIGHT - 16;
  draw(ctx, seller.nameAr, rightX, top - 28, { size: 14, align: 'right', color: COLOR_ACCENT });
  draw(ctx, seller.nameEn, rightX, top - 44, { size: 9, align: 'right', color: COLOR_MUTED, font: 'latin' });
  draw(ctx, `الرقم الضريبي: ${seller.vatNumber}`, rightX, top - 60, { size: 9, align: 'right' });
  draw(ctx, `السجل التجاري: ${seller.crNumber}`, rightX, top - 74, { size: 9, align: 'right' });
  draw(ctx, seller.phone, rightX, top - 88, { size: 9, align: 'right', color: COLOR_MUTED, font: 'latin' });

  // Invoice title bar.
  const titleY = top - bandHeight - 26;
  page.drawRectangle({
    x: CONTENT_LEFT,
    y: titleY - 6,
    width: CONTENT_WIDTH,
    height: 26,
    color: COLOR_ACCENT,
  });
  draw(ctx, data.invoiceType, CONTENT_RIGHT - 12, titleY + 2, { size: 13, align: 'right', color: WHITE });
  draw(ctx, 'TAX INVOICE', CONTENT_LEFT + 12, titleY + 2, { size: 11, align: 'left', color: WHITE, font: 'latin' });
}

function drawParties(ctx: RenderCtx, seller: SellerInfo, data: InvoiceData, startY: number): number {
  const { page } = ctx;
  const gap = 12;
  const colWidth = (CONTENT_WIDTH - gap) / 2;
  const blockHeight = 96;
  const blockTop = startY;
  const blockBottom = blockTop - blockHeight;

  // Right column: invoice meta. Left column: buyer.
  const rightX = CONTENT_RIGHT;
  const leftColRight = CONTENT_LEFT + colWidth;

  // Boxes.
  page.drawRectangle({
    x: CONTENT_RIGHT - colWidth,
    y: blockBottom,
    width: colWidth,
    height: blockHeight,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
    color: COLOR_ZEBRA,
  });
  page.drawRectangle({
    x: CONTENT_LEFT,
    y: blockBottom,
    width: colWidth,
    height: blockHeight,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  // Invoice meta (right).
  let y = blockTop - 18;
  draw(ctx, 'بيانات الفاتورة', rightX - 10, y, { size: 10, align: 'right', color: COLOR_ACCENT });
  y -= 16;
  const metaRows: Array<[string, string]> = [
    ['رقم الفاتورة', data.invoiceNumber],
    ['التاريخ', data.date],
    ['رقم الطلب', data.orderNumber],
    ['طريقة الدفع', data.paymentMethod],
  ];
  for (const [label, value] of metaRows) {
    draw(ctx, `${label}:`, rightX - 10, y, { size: 9, align: 'right', color: COLOR_MUTED });
    draw(ctx, value, rightX - 100, y, { size: 9, align: 'right' });
    y -= 15;
  }

  // Buyer (left column, but content right-aligned within it for Arabic).
  let by = blockTop - 18;
  draw(ctx, 'بيانات العميل', leftColRight - 10, by, { size: 10, align: 'right', color: COLOR_ACCENT });
  by -= 16;
  const buyerRows: Array<[string, string]> = [
    ['الاسم', data.buyerName],
    ['الجوال', data.buyerPhone || '—'],
    ['البريد', data.buyerEmail || '—'],
  ];
  for (const [label, value] of buyerRows) {
    draw(ctx, `${label}:`, leftColRight - 10, by, { size: 9, align: 'right', color: COLOR_MUTED });
    draw(ctx, value, leftColRight - 70, by, { size: 9, align: 'right' });
    by -= 15;
  }
  // Address wrapped.
  const addrLines = wrap(data.buyerAddress, 42).slice(0, 2);
  draw(ctx, 'العنوان:', leftColRight - 10, by, { size: 9, align: 'right', color: COLOR_MUTED });
  by -= 13;
  for (const line of addrLines) {
    draw(ctx, line, leftColRight - 10, by, { size: 8.5, align: 'right' });
    by -= 12;
  }

  return blockBottom - 18;
}

function drawItemsTable(ctx: RenderCtx, data: InvoiceData, startY: number): number {
  const { page } = ctx;
  // Column layout (right -> left): Product | Qty | Unit | VAT | Total
  // Define right edges of each column as fractions of content width.
  const x0 = CONTENT_LEFT;
  const x1 = CONTENT_RIGHT;
  const colTotalW = 70;
  const colVatW = 70;
  const colUnitW = 70;
  const colQtyW = 40;
  // Product takes the remaining width on the right.
  const productRight = x1;
  const productLeft = x1 - (CONTENT_WIDTH - colTotalW - colVatW - colUnitW - colQtyW);
  const qtyRight = productLeft;
  const unitRight = qtyRight - colQtyW;
  const vatRight = unitRight - colUnitW;
  const totalRight = vatRight - colVatW;

  const headH = 22;
  const rowH = 26;
  const headTop = startY;

  // Header band.
  page.drawRectangle({
    x: x0,
    y: headTop - headH,
    width: CONTENT_WIDTH,
    height: headH,
    color: COLOR_TABLE_HEAD,
  });
  const headTextY = headTop - 15;
  draw(ctx, 'المنتج', productRight - 8, headTextY, { size: 9.5, align: 'right', color: WHITE });
  draw(ctx, 'الكمية', qtyRight - 6, headTextY, { size: 9, align: 'right', color: WHITE });
  draw(ctx, 'السعر', unitRight - 6, headTextY, { size: 9, align: 'right', color: WHITE });
  draw(ctx, 'الضريبة', vatRight - 6, headTextY, { size: 9, align: 'right', color: WHITE });
  draw(ctx, 'الإجمالي', totalRight - 6, headTextY, { size: 9, align: 'right', color: WHITE });

  let y = headTop - headH;
  data.items.forEach((item, idx) => {
    const rowBottom = y - rowH;
    if (idx % 2 === 1) {
      page.drawRectangle({ x: x0, y: rowBottom, width: CONTENT_WIDTH, height: rowH, color: COLOR_ZEBRA });
    }
    const nameY = y - 12;
    const productName = truncate(item.name, 34);
    draw(ctx, productName, productRight - 8, nameY, { size: 9, align: 'right' });
    if (item.sku) {
      draw(ctx, `SKU: ${item.sku}`, productRight - 8, y - 22, { size: 7.5, align: 'right', color: COLOR_MUTED, font: 'latin' });
    }
    const midY = y - 16;
    draw(ctx, String(item.quantity), qtyRight - 6, midY, { size: 9, align: 'right', font: 'latin' });
    draw(ctx, formatMoney(item.unitPrice), unitRight - 6, midY, { size: 8.5, align: 'right', font: 'latin' });
    draw(ctx, formatMoney(item.taxAmount), vatRight - 6, midY, { size: 8.5, align: 'right', font: 'latin' });
    draw(ctx, formatMoney(item.total), totalRight - 6, midY, { size: 8.5, align: 'right', font: 'latin' });

    page.drawLine({
      start: { x: x0, y: rowBottom },
      end: { x: x1, y: rowBottom },
      color: COLOR_BORDER,
      thickness: 0.5,
    });
    y = rowBottom;
  });

  // Outer border for the table.
  page.drawRectangle({
    x: x0,
    y,
    width: CONTENT_WIDTH,
    height: headTop - y,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  return y - 18;
}

function drawTotals(ctx: RenderCtx, data: InvoiceData, startY: number): number {
  const boxWidth = 240;
  const boxLeft = CONTENT_RIGHT - boxWidth;
  const labelX = CONTENT_RIGHT - 10;
  const valueX = boxLeft + 10;

  const rows: Array<[string, number, boolean]> = [
    ['المجموع الفرعي (غير شامل الضريبة)', data.subtotal, false],
  ];
  if (data.shipping) rows.push(['الشحن', data.shipping, false]);
  if (data.codFee) rows.push(['رسوم الدفع عند الاستلام', data.codFee, false]);
  if (data.discount) rows.push(['الخصم', -data.discount, false]);
  rows.push([`ضريبة القيمة المضافة (${data.taxPercent}%)`, data.taxAmount, false]);

  const rowH = 16;
  let y = startY - 4;
  for (const [label, value] of rows) {
    draw(ctx, label, labelX, y, { size: 8.5, align: 'right', color: COLOR_MUTED });
    draw(ctx, `${formatMoney(value)} ${data.currency}`, valueX, y, { size: 8.5, align: 'left', font: 'latin' });
    y -= rowH;
  }

  // Grand total bar.
  const barTop = y - 2;
  ctx.page.drawRectangle({
    x: boxLeft,
    y: barTop - 22,
    width: boxWidth,
    height: 24,
    color: COLOR_ACCENT,
  });
  draw(ctx, 'الإجمالي شامل الضريبة', labelX, barTop - 16, { size: 10, align: 'right', color: WHITE });
  draw(ctx, `${formatMoney(data.total)} ${data.currency}`, valueX, barTop - 16, { size: 10, align: 'left', color: WHITE, font: 'latin' });

  return barTop - 30;
}

function drawQrAndFooter(ctx: RenderCtx, seller: SellerInfo, data: InvoiceData, startY: number): void {
  // QR (ZATCA) bottom-left.
  const payload = buildZatcaQrPayload(seller, data);
  const matrix = encodeQr(payload, 'MEDIUM');
  const qrSize = 96;
  const module = qrSize / matrix.length;
  const qrX = CONTENT_LEFT;
  const qrY = Math.min(startY - qrSize, 150);

  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (matrix[r][c]) {
        ctx.page.drawRectangle({
          x: qrX + c * module,
          // matrix row 0 is the top; PDF y grows upward.
          y: qrY + (matrix.length - 1 - r) * module,
          width: module,
          height: module,
          color: rgb(0, 0, 0),
        });
      }
    }
  }
  draw(ctx, 'رمز الاستجابة السريعة (ZATCA)', qrX, qrY - 12, { size: 7.5, align: 'left', color: COLOR_MUTED });

  // Footer line.
  const footerY = 40;
  ctx.page.drawLine({
    start: { x: CONTENT_LEFT, y: footerY + 12 },
    end: { x: CONTENT_RIGHT, y: footerY + 12 },
    color: COLOR_BORDER,
    thickness: 0.8,
  });
  draw(ctx, seller.addressAr, CONTENT_RIGHT, footerY, { size: 8, align: 'right', color: COLOR_MUTED });
  draw(ctx, `${seller.email}  |  ${seller.phone}`, CONTENT_LEFT, footerY, { size: 8, align: 'left', color: COLOR_MUTED, font: 'latin' });
  draw(ctx, 'شكراً لتسوقكم معنا', PAGE_WIDTH / 2, footerY - 14, { size: 8.5, align: 'center', color: COLOR_ACCENT });
}

function drawTermsPage(ctx: RenderCtx, seller: SellerInfo): void {
  const page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.page = page;
  const top = PAGE_HEIGHT - MARGIN;

  page.drawRectangle({
    x: CONTENT_LEFT,
    y: top - 30,
    width: CONTENT_WIDTH,
    height: 30,
    color: COLOR_ACCENT,
  });
  draw(ctx, 'الشروط والأحكام وسياسة الاسترجاع', CONTENT_RIGHT - 12, top - 20, { size: 13, align: 'right', color: WHITE });

  const terms = [
    'يحق للعميل طلب استرجاع أو استبدال المنتج خلال المدة النظامية من تاريخ الاستلام.',
    'يجب أن يكون المنتج بحالته الأصلية وغير مستخدم وبكامل تغليفه وملحقاته.',
    'لا يمكن استرجاع المنتجات المخصصة أو المصممة حسب الطلب إلا في حال وجود عيب مصنعي.',
    'تتم إعادة المبلغ بنفس وسيلة الدفع المستخدمة عند الشراء بعد فحص المنتج المرتجع.',
    'تشمل جميع الأسعار ضريبة القيمة المضافة بنسبة 15% ما لم يُذكر خلاف ذلك.',
    'هذه فاتورة ضريبية صادرة إلكترونياً ولا تحتاج إلى توقيع أو ختم.',
  ];

  let y = top - 56;
  terms.forEach((term, i) => {
    const lines = wrap(term, 70);
    draw(ctx, `${toArabicDigits(i + 1)}.`, CONTENT_RIGHT, y, { size: 10, align: 'right', color: COLOR_ACCENT });
    lines.forEach((line, li) => {
      draw(ctx, line, CONTENT_RIGHT - 20, y - li * 14, { size: 9.5, align: 'right' });
    });
    y -= lines.length * 14 + 10;
  });

  // Footer.
  const footerY = 40;
  page.drawLine({
    start: { x: CONTENT_LEFT, y: footerY + 12 },
    end: { x: CONTENT_RIGHT, y: footerY + 12 },
    color: COLOR_BORDER,
    thickness: 0.8,
  });
  draw(ctx, seller.nameAr, CONTENT_RIGHT, footerY, { size: 8.5, align: 'right', color: COLOR_MUTED });
  draw(ctx, `الرقم الضريبي: ${seller.vatNumber}`, CONTENT_LEFT, footerY, { size: 8.5, align: 'left', color: COLOR_MUTED });
}

// ---------------------------------------------------------------------------
// Text utilities.
// ---------------------------------------------------------------------------
function wrap(value: string, maxChars: number): string[] {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncate(value: string, maxChars: number): string {
  const v = (value || '').trim();
  return v.length > maxChars ? `${v.slice(0, maxChars - 1)}…` : v;
}

function toArabicDigits(n: number): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(n)
    .split('')
    .map((d) => map[Number(d)] ?? d)
    .join('');
}
