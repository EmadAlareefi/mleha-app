import { promises as fs } from 'node:fs';
import path from 'node:path';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { ArabicShaper } from 'arabic-persian-reshaper';

import type { SallaOrder, SallaOrderItem } from './salla-api';
import { encodeCode128 } from './barcode-code128';

// ---------------------------------------------------------------------------
// Page / theme constants. The layout mirrors the Salla "فاتورة" tax-invoice
// template: a clean, grayscale A4 document (no colour accents) with a centred
// logo + title, divided info blocks, a products table, total rows and a
// second page carrying the contact details and return-policy declaration.
// ---------------------------------------------------------------------------
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 49;
const CONTENT_LEFT = MARGIN;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
const CENTER_X = PAGE_WIDTH / 2;
const COLUMN_GAP = 15;

const COLOR_TEXT = rgb(0.12, 0.12, 0.12);
const COLOR_MUTED = rgb(0.42, 0.42, 0.42);
const COLOR_LINE = rgb(0.85, 0.85, 0.85);
const COLOR_BAND = rgb(0.949, 0.949, 0.949);
const COLOR_ZEBRA = rgb(0.965, 0.965, 0.965);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts', 'invoice');
const FONT_FILES = {
  arReg: 'Tajawal-Regular.ttf',
  arBold: 'Tajawal-Bold.ttf',
  latReg: 'Tajawal-Latin-Regular.ttf',
  latBold: 'Tajawal-Latin-Bold.ttf',
} as const;

let cachedFonts: Promise<Record<keyof typeof FONT_FILES, Uint8Array>> | null = null;
let cachedLogo: Promise<Uint8Array | null> | null = null;

// ---------------------------------------------------------------------------
// Seller (static company details — overridable through env). Matches the
// values printed on the reference template.
// ---------------------------------------------------------------------------
export interface SellerInfo {
  nameAr: string;
  vatNumber: string;
  crNumber: string;
  country: string;
  city: string;
  addressAr: string;
  phone: string;
  email: string;
}

export function getSellerInfo(): SellerInfo {
  return {
    nameAr: process.env.INVOICE_SELLER_NAME_AR || 'المتجر الإلكتروني مليحة',
    vatNumber: process.env.INVOICE_SELLER_VAT || '311273037100003',
    crNumber: process.env.INVOICE_SELLER_CR || '268287708',
    country: process.env.INVOICE_SELLER_COUNTRY || 'السعودية',
    city: process.env.INVOICE_SELLER_CITY || 'جدة',
    addressAr:
      process.env.INVOICE_SELLER_ADDRESS_AR ||
      'المدن، البغدادية الغربية 7714 Halab, Al Baghdadiyah Al Gharbiyah District, 4443 Halab, 4443, جدة, MQ, SA, العنوان المختصر JABA4130',
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
  description?: string;
  imageUrl?: string;
  options: Array<{ name: string; value: string }>;
  quantity: number;
  unitPrice: number; // price excluding VAT, per the whole line
  taxPercent: number;
  taxAmount: number;
  total: number; // line total including VAT
}

export interface InvoiceOrderOption {
  name: string;
  content: string;
  price: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceType: string; // e.g. "فاتورة ضريبية"
  dateIso: string; // YYYY-MM-DD (for QR/ZATCA-style payloads if needed)
  dateLabel: string; // e.g. "Thursday 25 June 2026"
  timeLabel: string; // e.g. "02:16 AM"
  orderNumber: string;
  orderId: string;
  paymentMethod: string;
  currency: string;
  // Buyer ("مصدرة إلى")
  buyerName: string;
  buyerCountry: string;
  buyerCity: string;
  buyerAddress: string;
  buyerPhone: string;
  buyerEmail: string;
  // Shipping ("تفاصيل الشحن")
  shippingCourier: string;
  shippingExpected: string;
  totalWeight: number; // kg
  weightLabel: string;
  items: InvoiceLineItem[];
  // Totals
  subtotal: number;
  couponLabel: string; // e.g. "كوبون خصم ml ( كوبون عادي )" — empty to hide row
  couponAmount: number;
  shipping: number;
  shippingFree: boolean;
  codFee: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  orderOptions: InvoiceOrderOption[];
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
  const r = Math.round(value * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Splits a Salla date string into the "Thursday 25 June 2026" / "02:16 AM" parts. */
function formatDateParts(raw: string): { dateIso: string; dateLabel: string; timeLabel: string } {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  let Y: number, Mo: number, D: number, H: number, Mi: number;
  if (m) {
    Y = +m[1]; Mo = +m[2]; D = +m[3]; H = +m[4]; Mi = +m[5];
  } else {
    const now = new Date();
    Y = now.getUTCFullYear(); Mo = now.getUTCMonth() + 1; D = now.getUTCDate();
    H = now.getUTCHours(); Mi = now.getUTCMinutes();
  }
  // Use UTC accessors so the printed time matches the stored (store-local) value.
  const dow = new Date(Date.UTC(Y, Mo - 1, D)).getUTCDay();
  const dateLabel = `${WEEKDAYS[dow]} ${D} ${MONTHS[Mo - 1]} ${Y}`;
  const ampm = H >= 12 ? 'PM' : 'AM';
  const h12 = H % 12 === 0 ? 12 : H % 12;
  const timeLabel = `${String(h12).padStart(2, '0')}:${String(Mi).padStart(2, '0')} ${ampm}`;
  const dateIso = `${Y}-${String(Mo).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  return { dateIso, dateLabel, timeLabel };
}

function pickImageUrl(item: SallaOrderItem): string {
  const anyItem = item as unknown as AnyRecord;
  const images = (anyItem.images as AnyRecord[] | undefined) || [];
  for (const img of images) {
    const u = str(img?.image) || str(img?.url) || str((img?.original as AnyRecord)?.url);
    if (u) return u;
  }
  const thumb = str((item.product as AnyRecord | undefined)?.thumbnail);
  return thumb;
}

function pickOptions(item: SallaOrderItem): Array<{ name: string; value: string }> {
  const opts = (item.options as AnyRecord[] | undefined) || [];
  const out: Array<{ name: string; value: string }> = [];
  for (const opt of opts) {
    const name = str(opt?.name);
    const rawVal = opt?.value;
    let value = '';
    if (typeof rawVal === 'string' || typeof rawVal === 'number') value = str(rawVal);
    else if (rawVal && typeof rawVal === 'object') value = str((rawVal as AnyRecord).name) || str((rawVal as AnyRecord).value);
    if (Array.isArray(rawVal)) value = rawVal.map((v) => str((v as AnyRecord)?.name) || str(v)).filter(Boolean).join('، ');
    if (name && value) out.push({ name, value });
  }
  return out;
}

/**
 * Builds the normalised invoice model from a Salla order plus (optionally) its
 * tax-invoice record. The order supplies line items and customer details; the
 * invoice supplies the official number, date and tax totals.
 */
export function buildInvoiceData(order: SallaOrder, invoice: AnyRecord | null): InvoiceData {
  const orderAny = order as unknown as AnyRecord;
  const items: InvoiceLineItem[] = (order.items || []).map((item: SallaOrderItem) => {
    const a = (item.amounts || {}) as AnyRecord;
    const taxNode = (a.tax || {}) as AnyRecord;
    const anyItem = item as unknown as AnyRecord;
    return {
      name: item.name || str((item.product as AnyRecord | undefined)?.name) || '—',
      sku: item.sku || str((item.product as AnyRecord | undefined)?.sku),
      description: str(anyItem.description) || str((item.product as AnyRecord | undefined)?.description),
      imageUrl: pickImageUrl(item),
      options: pickOptions(item),
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

  // Resolve the receiver / shipping address.
  const ship =
    (orderAny.ship_to as AnyRecord | undefined) ||
    ((orderAny.shipping as AnyRecord | undefined)?.['address'] as AnyRecord | undefined) ||
    (orderAny.shipping as AnyRecord | undefined) ||
    {};
  const shipAny = ship as AnyRecord;
  const buyerCountry = str(shipAny.country) || str((customer as AnyRecord).country) || 'السعودية';
  const buyerCity = str(shipAny.city) || str(customer.city) || '';
  const addressParts = [
    str(shipAny.address_line) || str(shipAny.shipping_address) || str(shipAny.street_address),
    str(shipAny.block) && `حي ${str(shipAny.block)}`,
    str(shipAny.district),
    str(shipAny.postal_code) || str(shipAny.postcode),
  ].filter((p): p is string => Boolean(p && p.trim()));
  const buyerAddress = addressParts.join('، ');

  // Shipping company + expectations.
  const shippingNode = (orderAny.shipping as AnyRecord | undefined) || {};
  const shippingCourier =
    str(shippingNode.courier) ||
    str(shippingNode.company) ||
    str((shippingNode.shipping_company as AnyRecord | undefined)?.name) ||
    '';
  const shippingExpected =
    str(shippingNode.expected_delivery_at) ||
    str((shippingNode.option as AnyRecord | undefined)?.name) ||
    str(shippingNode.duration) ||
    '';
  const totalWeight = (order.items || []).reduce(
    (s, it) => s + (Number(it.weight) || 0) * (Number(it.quantity) || 1),
    0,
  );
  const weightLabel = str((order.items || [])[0]?.weight_label) || 'كجم';

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

  // Coupon row (shown when the order carries a coupon).
  const coupon = (orderAny.coupon as AnyRecord | undefined) || (inv.coupon as AnyRecord | undefined);
  let couponLabel = '';
  if (coupon) {
    const code = str(coupon.code) || str(coupon.name);
    const typeLabel = str((coupon.type as unknown) === 'fixed' ? 'كوبون عادي' : coupon.type) || 'كوبون عادي';
    couponLabel = code ? `كوبون خصم ${code} ( ${typeLabel} )` : '';
  }

  const dateRaw = str(inv.date) || str((order.date as AnyRecord | undefined)?.created);
  const { dateIso, dateLabel, timeLabel } = formatDateParts(dateRaw);

  // Order-level options (e.g. gift wrapping).
  const rawOrderOptions =
    (orderAny.order_options as AnyRecord[] | undefined) ||
    (orderAny.options as AnyRecord[] | undefined) ||
    [];
  const orderOptions: InvoiceOrderOption[] = rawOrderOptions
    .map((o) => ({
      name: str(o?.name),
      content: str(o?.value) || str((o?.value as AnyRecord)?.name) || '-',
      price: amountOf(o?.price),
    }))
    .filter((o) => o.name);

  return {
    invoiceNumber: str(inv.invoice_number) || str(inv.id) || str(order.reference_id) || str(order.id),
    invoiceType: str(inv.type) || 'فاتورة ضريبية',
    dateIso,
    dateLabel,
    timeLabel,
    orderNumber: str(order.reference_id) || str(order.order_number) || str(order.id),
    orderId: str(order.id),
    paymentMethod: translatePaymentMethod(str(inv.payment_method) || str(orderAny.payment_method)),
    currency: items[0] ? str((order.items[0].amounts.total as AnyRecord).currency) || 'SAR' : 'SAR',
    buyerName,
    buyerCountry,
    buyerCity,
    buyerAddress,
    buyerPhone: str(customer.mobile),
    buyerEmail: str(customer.email),
    shippingCourier,
    shippingExpected,
    totalWeight,
    weightLabel,
    items,
    subtotal,
    couponLabel,
    couponAmount: discount,
    shipping,
    shippingFree: shipping <= 0,
    codFee,
    taxPercent,
    taxAmount,
    total,
    orderOptions,
  };
}

function translatePaymentMethod(method: string): string {
  const m = method.toLowerCase();
  if (m === 'cod' || m.includes('cash')) return 'الدفع عند الاستلام';
  if (m.includes('tamara')) return 'تمارا';
  if (m.includes('tabby')) return 'تابي';
  if (m.includes('credit') || m.includes('card') || m === 'mada') return 'بطاقة';
  if (m.includes('apple')) return 'Apple Pay';
  if (m.includes('bank')) return 'تحويل بنكي';
  return method || '—';
}

// ---------------------------------------------------------------------------
// Asset loading.
// ---------------------------------------------------------------------------
async function loadFonts(): Promise<Record<keyof typeof FONT_FILES, Uint8Array>> {
  if (!cachedFonts) {
    cachedFonts = (async () => {
      const entries = await Promise.all(
        (Object.keys(FONT_FILES) as Array<keyof typeof FONT_FILES>).map(async (key) => {
          const data = new Uint8Array(await fs.readFile(path.join(FONT_DIR, FONT_FILES[key])));
          return [key, data] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<keyof typeof FONT_FILES, Uint8Array>;
    })();
  }
  return cachedFonts;
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

async function fetchImage(pdf: PDFDocument, url: string): Promise<PDFImage | null> {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // Detect PNG (\x89PNG) vs JPEG (\xFF\xD8).
    if (buf[0] === 0x89 && buf[1] === 0x50) return await pdf.embedPng(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8) return await pdf.embedJpg(buf);
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Renderer.
// ---------------------------------------------------------------------------
interface RenderCtx {
  pdf: PDFDocument;
  arReg: PDFFont;
  arBold: PDFFont;
  latReg: PDFFont;
  latBold: PDFFont;
  logo: PDFImage | null;
  page: PDFPage;
}

export async function generateSallaInvoicePdf(
  data: InvoiceData,
  seller: SellerInfo = getSellerInfo(),
): Promise<Buffer> {
  const fonts = await loadFonts();
  const logoData = await loadLogo();

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const [arReg, arBold, latReg, latBold] = await Promise.all([
    pdf.embedFont(fonts.arReg, { subset: true }),
    pdf.embedFont(fonts.arBold, { subset: true }),
    pdf.embedFont(fonts.latReg, { subset: true }),
    pdf.embedFont(fonts.latBold, { subset: true }),
  ]);
  let logo: PDFImage | null = null;
  if (logoData) {
    try {
      logo = await pdf.embedPng(logoData);
    } catch {
      logo = null;
    }
  }

  const productImages = await Promise.all(
    data.items.map((it) => (it.imageUrl ? fetchImage(pdf, it.imageUrl) : Promise.resolve(null))),
  );

  const ctx: RenderCtx = {
    pdf,
    arReg,
    arBold,
    latReg,
    latBold,
    logo,
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
  };

  drawHeader(ctx, data);
  drawOrderDetails(ctx, seller, data);
  drawParties(ctx, seller, data);
  drawPaymentShipping(ctx, data);
  drawItemsTable(ctx, data, productImages[0] ?? null);
  drawTotals(ctx, data);
  drawOrderOptions(ctx, data);

  drawSecondPage(ctx, seller);

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

const ARABIC_CHAR_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

// The reshaper emits Farsi-yeh presentation forms (U+FBFC–FBFF) for ى/ي. Map
// them to the Arabic alef-maksura / yeh forms that the Tajawal subset carries.
const YEH_REMAP: Record<string, string> = {
  'ﯼ': 'ﻯ', // isolated -> alef maksura isolated
  'ﯽ': 'ﻰ', // final    -> alef maksura final
  'ﯾ': 'ﻳ', // initial  -> yeh initial
  'ﯿ': 'ﻴ', // medial   -> yeh medial
};

function shape(value: string): string {
  if (!ARABIC_CHAR_RE.test(value)) return value;
  const shaped = ArabicShaper.convertArabic(value);
  return shaped.replace(/[ﯼ-ﯿ]/g, (c) => YEH_REMAP[c] ?? c);
}

interface DrawOpts {
  size?: number;
  color?: ReturnType<typeof rgb>;
  align?: 'left' | 'right' | 'center';
  bold?: boolean;
}

interface ScriptRun {
  isAr: boolean;
  text: string;
}

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };
const OPEN_BRACKETS = '([{<';
const CLOSE_BRACKETS = ')]}>';

/** True when a bracket at index `i` wraps Arabic text (its inner neighbour is Arabic). */
function bracketWrapsArabic(chars: string[], i: number): boolean {
  const ch = chars[i];
  if (OPEN_BRACKETS.includes(ch)) {
    for (let j = i + 1; j < chars.length; j++) if (!/\s/.test(chars[j])) return ARABIC_CHAR_RE.test(chars[j]);
  } else if (CLOSE_BRACKETS.includes(ch)) {
    for (let j = i - 1; j >= 0; j--) if (!/\s/.test(chars[j])) return ARABIC_CHAR_RE.test(chars[j]);
  }
  return false;
}

/**
 * Splits logical text into Arabic / non-Arabic runs. Whitespace inherits the
 * surrounding strong script (so Arabic phrases stay intact); ASCII punctuation
 * stays with the Latin side so it renders from the Latin font (the Arabic
 * subset has no ASCII glyphs). Brackets that wrap an Arabic phrase are split
 * into their own (mirrored) runs so they reorder correctly; brackets inside a
 * Latin/number island (e.g. "(15%)") stay put.
 */
function classifyRuns(text: string): ScriptRun[] {
  const chars = [...text];
  const isWrapBracket = chars.map((ch, i) => MIRROR[ch] && bracketWrapsArabic(chars, i));
  const scripts: Array<'ar' | 'lat' | null> = chars.map((ch, i) => {
    if (ARABIC_CHAR_RE.test(ch)) return 'ar';
    if (isWrapBracket[i]) return 'lat';
    if (/\s/.test(ch)) return null; // neutral whitespace
    return 'lat'; // Latin letters, digits and ASCII punctuation
  });
  let prev: 'ar' | 'lat' = 'ar';
  for (let i = 0; i < scripts.length; i++) {
    if (scripts[i]) {
      prev = scripts[i] as 'ar' | 'lat';
    } else {
      let next: 'ar' | 'lat' | null = null;
      for (let j = i + 1; j < scripts.length; j++) {
        if (scripts[j]) { next = scripts[j]; break; }
      }
      scripts[i] = i === 0 && next ? next : prev;
    }
  }
  const runs: ScriptRun[] = [];
  for (let i = 0; i < chars.length; i++) {
    const isAr = scripts[i] === 'ar';
    const ch = isWrapBracket[i] ? MIRROR[chars[i]] : chars[i];
    // Wrap-brackets always start (and end) their own run so they reorder cleanly.
    const breakRun = isWrapBracket[i] || (i > 0 && isWrapBracket[i - 1]);
    if (!breakRun && runs.length && runs[runs.length - 1].isAr === isAr) runs[runs.length - 1].text += ch;
    else runs.push({ isAr, text: ch });
  }
  return runs;
}

function runWidth(ctx: RenderCtx, run: ScriptRun, size: number, bold: boolean): { font: PDFFont; text: string; width: number } {
  const font = run.isAr ? (bold ? ctx.arBold : ctx.arReg) : bold ? ctx.latBold : ctx.latReg;
  const text = run.isAr ? shape(run.text) : run.text;
  return { font, text, width: font.widthOfTextAtSize(text, size) };
}

function measure(ctx: RenderCtx, text: string, size: number, bold = false): number {
  return classifyRuns(text).reduce((s, run) => s + runWidth(ctx, run, size, bold).width, 0);
}

function draw(ctx: RenderCtx, text: string, x: number, y: number, opts: DrawOpts = {}): number {
  const size = opts.size ?? 9.5;
  const color = opts.color ?? COLOR_TEXT;
  const align = opts.align ?? 'left';
  const bold = opts.bold ?? false;

  const rendered = classifyRuns(text).map((run) => runWidth(ctx, run, size, bold));
  const totalWidth = rendered.reduce((s, r) => s + r.width, 0);

  let startX = x;
  if (align === 'right') startX = x - totalWidth;
  else if (align === 'center') startX = x - totalWidth / 2;

  // RTL base: lay runs out in reverse logical order (first logical run sits
  // visually right-most). Each Arabic run is already display-ordered.
  let cursor = startX;
  for (let i = rendered.length - 1; i >= 0; i--) {
    ctx.page.drawText(rendered[i].text, { x: cursor, y, font: rendered[i].font, size, color });
    cursor += rendered[i].width;
  }
  return totalWidth;
}

function hline(ctx: RenderCtx, y: number, color = COLOR_LINE, thickness = 0.8): void {
  ctx.page.drawLine({
    start: { x: CONTENT_LEFT, y },
    end: { x: CONTENT_RIGHT, y },
    color,
    thickness,
  });
}

/** Heading with an underline, right-aligned at `rightX`. */
function heading(ctx: RenderCtx, text: string, rightX: number, y: number, size = 10.5): void {
  const w = draw(ctx, text, rightX, y, { size, align: 'right', bold: true });
  ctx.page.drawLine({
    start: { x: rightX, y: y - 3 },
    end: { x: rightX - w, y: y - 3 },
    color: COLOR_TEXT,
    thickness: 0.6,
  });
}

function drawBarcode(
  ctx: RenderCtx,
  value: string,
  centerX: number,
  baselineY: number,
  height: number,
  targetWidth: number,
): void {
  const { runs, modules } = encodeCode128(value);
  const mw = targetWidth / modules;
  let x = centerX - targetWidth / 2;
  let bar = true; // first run is a bar
  for (const run of runs) {
    const w = run * mw;
    if (bar) {
      ctx.page.drawRectangle({ x, y: baselineY, width: w, height, color: BLACK });
    }
    x += w;
    bar = !bar;
  }
  draw(ctx, value, centerX, baselineY - 10, { size: 8, align: 'center', color: COLOR_TEXT });
}

// Template-derived baselines (top-origin → PDF bottom-origin).
const T = (oy: number) => PAGE_HEIGHT - oy;
const RIGHT = CONTENT_RIGHT; // right-column / page right edge
const LEFT_COL_RIGHT = 290; // left-column right edge (from template)

function drawHeader(ctx: RenderCtx, data: InvoiceData): void {
  if (ctx.logo) {
    const maxH = 24;
    const scale = maxH / ctx.logo.height;
    const w = ctx.logo.width * scale;
    ctx.page.drawImage(ctx.logo, { x: CENTER_X - w / 2, y: T(48), width: w, height: maxH });
  }
  draw(ctx, data.invoiceType.includes('ضريبية') ? 'فاتورة' : data.invoiceType, CENTER_X, T(73.5), {
    size: 17,
    align: 'center',
    bold: true,
  });
}

/** Draws "label : value" right-anchored, value to the left of the label. */
function metaRow(ctx: RenderCtx, label: string, value: string, rightX: number, y: number, size = 9.8, bold = true): void {
  const w = draw(ctx, `${label} :`, rightX, y, { size, align: 'right', bold });
  draw(ctx, value, rightX - w - 5, y, { size, align: 'right' });
}

function drawOrderDetails(ctx: RenderCtx, seller: SellerInfo, data: InvoiceData): void {
  // Right column: order details.
  draw(ctx, 'تفاصيل الطلب', RIGHT, T(111.8), { size: 9.8, align: 'right', bold: true });
  metaRow(ctx, 'رقم الطلب', data.orderNumber, RIGHT, T(126.8));
  metaRow(ctx, 'الرقم الضريبي', seller.vatNumber, RIGHT, T(141.8));

  // Left column: date label + barcode.
  const leftRight = 205;
  const dateLabelW = draw(ctx, 'تاريخ الطلب: |', leftRight, T(110.2), { size: 8.3, align: 'right' });
  draw(ctx, data.dateLabel, leftRight - dateLabelW - 4, T(110.2), { size: 8.3, align: 'right' });
  draw(ctx, data.timeLabel, leftRight, T(123), { size: 8.3, align: 'right' });
  drawBarcode(ctx, data.orderNumber, 130, T(152), 20, 150);

  hline(ctx, T(165));
}

interface Line {
  text: string;
  size?: number;
}

/** Draws a labelled info column: heading, then a stack of (wrapped) lines. */
function drawInfoColumn(ctx: RenderCtx, headingText: string, lines: Line[], rightX: number, leftX: number): void {
  heading(ctx, headingText, rightX, T(173.2), 9.8);
  let y = T(189);
  for (const line of lines) {
    if (!line.text) continue;
    const size = line.size ?? 9;
    for (const w of wrapToWidth(ctx, line.text, rightX - leftX, size, false)) {
      draw(ctx, w, rightX, y, { size, align: 'right' });
      y -= 16.5;
    }
  }
}

function drawParties(ctx: RenderCtx, seller: SellerInfo, data: InvoiceData): void {
  const sellerLines: Line[] = [
    { text: seller.nameAr },
    { text: seller.country },
    { text: seller.city },
    { text: seller.addressAr },
    { text: seller.email },
    { text: seller.phone },
  ];
  const buyerLines: Line[] = [
    { text: data.buyerName },
    { text: data.buyerCountry },
    { text: data.buyerCity },
    { text: data.buyerAddress },
    { text: data.buyerPhone },
    { text: data.buyerEmail },
  ];
  drawInfoColumn(ctx, 'مصدرة من :', sellerLines, RIGHT, CENTER_X + COLUMN_GAP / 2);
  drawInfoColumn(ctx, 'مصدرة إلى :', buyerLines, LEFT_COL_RIGHT, CONTENT_LEFT);
  hline(ctx, T(317));
}

/** A single label:value line — bold label right-anchored, value to its left. */
function labelValueRow(ctx: RenderCtx, label: string, value: string, rightX: number, y: number): void {
  const w = draw(ctx, `${label}:`, rightX, y, { size: 9, align: 'right', bold: true });
  draw(ctx, value, rightX - w - 6, y, { size: 9, align: 'right' });
}

function drawPaymentShipping(ctx: RenderCtx, data: InvoiceData): void {
  // Right column: payment.
  heading(ctx, 'تفاصيل الدفع :', RIGHT, T(328.5), 9.8);
  labelValueRow(ctx, 'المبلغ', `${data.currency} ${formatMoney(data.total)}`, RIGHT, T(344.2));
  labelValueRow(ctx, 'طريقة الدفع', data.paymentMethod, RIGHT, T(360.8));

  // Left column: shipping.
  heading(ctx, 'تفاصيل الشحن :', LEFT_COL_RIGHT, T(328.5), 9.8);
  const shipY = [T(344.2), T(360.8), T(377.2)];
  let si = 0;
  if (data.shippingCourier) labelValueRow(ctx, 'بواسطة', data.shippingCourier, LEFT_COL_RIGHT, shipY[si++]);
  if (data.shippingExpected) labelValueRow(ctx, 'عدد الأيام المتوقعة للشحن', data.shippingExpected, LEFT_COL_RIGHT, shipY[si++]);
  labelValueRow(
    ctx,
    'اجمالي الوزن',
    `${toArabicDigits(data.totalWeight.toFixed(1)).replace('.', '٫')} ${data.weightLabel}`,
    LEFT_COL_RIGHT,
    shipY[Math.min(si, 2)],
  );

  hline(ctx, T(392));
}

function drawItemsTable(ctx: RenderCtx, data: InvoiceData, image: PDFImage | null): void {
  const x0 = CONTENT_LEFT;
  const productRight = RIGHT;
  const qtyRight = 272;
  const priceRight = 230;
  const totalRight = 103;

  // Header band.
  ctx.page.drawRectangle({ x: x0, y: T(424), width: CONTENT_WIDTH, height: 23, color: COLOR_BAND });
  const headY = T(413.2);
  draw(ctx, 'المنتج', productRight, headY, { size: 9.8, align: 'right', bold: true });
  draw(ctx, 'الكمية', qtyRight, headY, { size: 9.8, align: 'right', bold: true });
  draw(ctx, 'السعر', priceRight, headY, { size: 9.8, align: 'right', bold: true });
  draw(ctx, 'المجموع', totalRight, headY, { size: 9.8, align: 'right', bold: true });

  // Single product row (the template carries one line item).
  const item = data.items[0];
  if (item) {
    let nameRight = productRight;
    if (image) {
      const imgSize = 58;
      const scale = imgSize / Math.max(image.width, image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.page.drawImage(image, { x: productRight - w, y: T(436.5) - h + 4, width: w, height: h });
      nameRight = productRight - imgSize - 8;
    }
    draw(ctx, item.name, nameRight, T(436.5), { size: 9, align: 'right' });
    if (item.sku) draw(ctx, `SKU ${item.sku}`, nameRight, T(450), { size: 9, align: 'right', bold: true });
    if (item.description) {
      draw(ctx, `${truncate(item.description, 42)}...`, nameRight, T(465), { size: 9, align: 'right', color: COLOR_MUTED });
    }

    draw(ctx, String(item.quantity), qtyRight - 4, T(436.5), { size: 9, align: 'right' });
    draw(ctx, `${data.currency} ${formatMoney(item.unitPrice)}`, priceRight, T(436.5), { size: 9, align: 'right' });
    draw(ctx, `${data.currency} ${formatMoney(item.unitPrice)}`, totalRight, T(436.5), { size: 9, align: 'right' });
    draw(ctx, `الضريبة (${data.taxPercent}%) : ${data.currency} ${formatMoney(item.taxAmount)}`, priceRight, T(451.5), { size: 9, align: 'right', color: COLOR_MUTED });
    draw(ctx, `السعر شامل الضريبة : ${data.currency} ${formatMoney(item.total)}`, priceRight, T(466.5), { size: 9, align: 'right', color: COLOR_MUTED });

    if (item.sku) drawBarcode(ctx, item.sku, 130, T(505), 22, 150);

    if (item.options.length) {
      heading(ctx, 'خيارات المنتج', productRight, T(525), 9.8);
      let oy = T(540.8);
      for (const opt of item.options) {
        draw(ctx, opt.name, productRight, oy, { size: 9, align: 'right', bold: true });
        draw(ctx, opt.value, 372, oy, { size: 9, align: 'left' });
        oy -= 16;
      }
    }
  }

  hline(ctx, T(553));
}

function drawTotals(ctx: RenderCtx, data: InvoiceData): void {
  const rows: Array<[string, string]> = [];
  rows.push(['الإجمالي الفرعي (غير شامل الضريبة)', `${data.currency} ${formatMoney(data.subtotal)}`]);
  if (data.couponLabel) rows.push([data.couponLabel, `${data.currency} ${formatMoney(data.couponAmount)}`]);
  if (data.codFee) rows.push(['رسوم الدفع عند الاستلام', `${data.currency} ${formatMoney(data.codFee)}`]);
  rows.push(['تكلفة الشحن', data.shippingFree ? 'مجانًا' : `${data.currency} ${formatMoney(data.shipping)}`]);
  rows.push([`الضريبة (${data.taxPercent}%)`, `${data.currency} ${formatMoney(data.taxAmount)} +`]);
  rows.push(['إجمالي الطلب', `${data.currency} ${formatMoney(data.total)}`]);

  const rowH = 25.5;
  let top = T(556); // band top of first row
  rows.forEach(([label, value], idx) => {
    if (idx % 2 === 0) {
      ctx.page.drawRectangle({ x: CONTENT_LEFT, y: top - rowH, width: CONTENT_WIDTH, height: rowH, color: COLOR_ZEBRA });
    }
    const ty = top - 17;
    draw(ctx, label, CONTENT_RIGHT - 1, ty, { size: 9, align: 'right', bold: true });
    draw(ctx, value, CONTENT_LEFT + 2, ty, { size: 10.5, align: 'left', bold: true });
    top -= rowH;
  });
}

function drawOrderOptions(ctx: RenderCtx, data: InvoiceData): void {
  if (!data.orderOptions.length) return;
  const x0 = CONTENT_LEFT;
  const optRight = CONTENT_RIGHT;
  const contentCenter = 320;
  const priceLeft = CONTENT_LEFT;

  ctx.page.drawRectangle({ x: x0, y: T(720), width: CONTENT_WIDTH, height: 22, color: COLOR_BAND });
  const hy = T(709.5);
  draw(ctx, 'خيارات الطلب', optRight, hy, { size: 9, align: 'right', bold: true });
  draw(ctx, 'المحتوى', contentCenter, hy, { size: 9, align: 'center', bold: true });
  draw(ctx, 'السعر (شامل الضريبة)', priceLeft, hy, { size: 9, align: 'left', bold: true });

  const rowY = [T(732.8), T(755.2)];
  data.orderOptions.slice(0, 2).forEach((opt, i) => {
    draw(ctx, opt.name, optRight, rowY[i], { size: 9, align: 'right' });
    draw(ctx, opt.content || '-', contentCenter, rowY[i], { size: 9, align: 'center' });
    draw(ctx, `${data.currency} ${formatMoney(opt.price)}`, priceLeft, rowY[i], { size: 9, align: 'left' });
  });
  hline(ctx, T(777));
}

function drawSecondPage(ctx: RenderCtx, seller: SellerInfo): void {
  const page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.page = page;

  // Contact details — bold block, right-aligned near the top-left (x≈196).
  const blockRight = 196;
  let y = PAGE_HEIGHT - 24;
  draw(ctx, 'بيانات التواصل', blockRight, y, { size: 11, align: 'right', bold: true });
  y -= 18;
  for (const line of [seller.nameAr, seller.phone, seller.email]) {
    draw(ctx, line, blockRight, y, { size: 10, align: 'right', bold: true });
    y -= 17;
  }

  // Declaration — right side.
  draw(ctx, 'الإقرار', CONTENT_RIGHT, PAGE_HEIGHT - 97, { size: 11, align: 'right', bold: true });
  draw(
    ctx,
    'أقر بأني قرأت وأوافق على سياسة الاستبدال والاسترجاع و سياسة الشحن والتوصيل',
    CONTENT_RIGHT,
    PAGE_HEIGHT - 116,
    { size: 10, align: 'right', bold: true },
  );

  // Thank-you line — centred.
  draw(ctx, 'شكراً لشرائك من المتجر . نتمنى لك يوماً رائعاً !', CENTER_X, PAGE_HEIGHT - 168, {
    size: 11,
    align: 'center',
  });
}

// ---------------------------------------------------------------------------
// Text utilities.
// ---------------------------------------------------------------------------
function wrapToWidth(ctx: RenderCtx, value: string, maxWidth: number, size: number, bold: boolean): string[] {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(ctx, candidate, size, bold) > maxWidth && current) {
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

function toArabicDigits(s: string): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return s.replace(/\d/g, (d) => map[Number(d)]);
}
