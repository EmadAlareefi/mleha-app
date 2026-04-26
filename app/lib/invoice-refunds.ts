import 'server-only';

import fs from 'fs';
import path from 'path';
import type { SallaOrder } from '@prisma/client';
import * as XLSX from 'xlsx';
import { postInvoiceToERP, transformOrderToERPInvoice } from '@/app/lib/erp-invoice';
import { prisma } from '@/lib/prisma';

const WORKBOOK_FILE_NAME = 'invoices.xlsx';
const HEADER_ROW_LABEL = 'النوع';
const REQUIRED_HEADERS = [
  'النوع',
  'الرقم',
  'اجمالي الفاتورة',
  'اسم العميل او الحساب',
] as const;
const CUSTOMER_HEADER = 'اسم العميل او الحساب';
const ERP_REFUND_INVOICE_ID_HEADER = 'رقم فاتورة المرتجع ERP';
const ORDER_NUMBER_REGEX = /(\d{6,})/;

export type InvoiceRefundRowStatus =
  | 'ready'
  | 'refunded'
  | 'missing_order_number'
  | 'order_not_found'
  | 'conflict';

type CellValue = string | number | null;

type WorkbookRow = {
  rowKey: string;
  rowNumber: number;
  sheetName: string;
  cells: Record<string, CellValue>;
  orderNumber: string | null;
  erpRefundInvoiceId: string | null;
  effectiveERPRefundInvoiceId: string | null;
  duplicateCount: number;
  hasConflictingERPRefundIds: boolean;
};

type WorkbookState = {
  workbook: XLSX.WorkBook;
  worksheet: XLSX.WorkSheet;
  filePath: string;
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  hasERPRefundHeader: boolean;
  rows: WorkbookRow[];
};

type OrderSummary = {
  orderId: string;
  orderNumber: string | null;
  statusSlug: string | null;
};

export type InvoiceRefundListRow = {
  rowKey: string;
  rowNumber: number;
  sheetName: string;
  cells: Record<string, CellValue>;
  orderNumber: string | null;
  orderFound: boolean;
  orderStatus: string | null;
  erpRefundInvoiceId: string | null;
  effectiveERPRefundInvoiceId: string | null;
  duplicateCount: number;
  hasConflictingERPRefundIds: boolean;
  status: InvoiceRefundRowStatus;
  statusLabel: string;
  statusMessage: string | null;
  canRefund: boolean;
};

export type InvoiceRefundWorkbookData = {
  fileName: string;
  filePath: string;
  sheetName: string;
  modifiedAt: string;
  headers: string[];
  rows: InvoiceRefundListRow[];
};

export type RefundInvoiceWorkbookResult = {
  alreadyRecorded: boolean;
  erpInvoiceId: string;
  updatedRowNumbers: number[];
  message: string;
};

export class InvoiceRefundError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'InvoiceRefundError';
    this.statusCode = statusCode;
  }
}

let workbookMutationQueue: Promise<unknown> = Promise.resolve();

function queueWorkbookMutation<T>(task: () => Promise<T>): Promise<T> {
  const result = workbookMutationQueue.then(task, task);
  workbookMutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCellValue(value: unknown): CellValue {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = normalizeString(value);
  return normalized ? normalized : null;
}

function findHeaderRow(rows: unknown[][]): number {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeString);
    return REQUIRED_HEADERS.every((required) => headers.includes(required)) && headers.includes(HEADER_ROW_LABEL);
  });

  if (headerIndex === -1) {
    throw new InvoiceRefundError('تعذر العثور على صف العناوين داخل ملف invoices.xlsx', 500);
  }

  return headerIndex;
}

function toWslPathFromWindowsPath(input: string): string | null {
  const match = input.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) {
    return null;
  }

  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return path.posix.join('/mnt', drive, rest);
}

function toWindowsPathFromWslPath(input: string): string | null {
  const match = input.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) {
    return null;
  }

  const drive = match[1].toUpperCase();
  const rest = match[2].replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}

function getWorkbookPathCandidates(): string[] {
  const cwd = process.cwd();
  const candidates = new Set<string>();

  const addCandidate = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }

    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }

    candidates.add(normalized);
  };

  const envPath = process.env.INVOICE_REFUNDS_WORKBOOK_PATH;

  addCandidate(envPath);
  addCandidate(envPath ? path.join(envPath, WORKBOOK_FILE_NAME) : null);
  addCandidate(path.join(cwd, WORKBOOK_FILE_NAME));
  addCandidate(path.resolve(cwd, WORKBOOK_FILE_NAME));

  const cwdAsWsl = toWslPathFromWindowsPath(cwd);
  addCandidate(cwdAsWsl ? path.posix.join(cwdAsWsl, WORKBOOK_FILE_NAME) : null);

  const cwdAsWindows = toWindowsPathFromWslPath(cwd);
  addCandidate(cwdAsWindows ? path.win32.join(cwdAsWindows, WORKBOOK_FILE_NAME) : null);

  if (envPath) {
    const envAsWsl = toWslPathFromWindowsPath(envPath);
    addCandidate(envAsWsl);
    addCandidate(envAsWsl ? path.posix.join(envAsWsl, WORKBOOK_FILE_NAME) : null);

    const envAsWindows = toWindowsPathFromWslPath(envPath);
    addCandidate(envAsWindows);
    addCandidate(envAsWindows ? path.win32.join(envAsWindows, WORKBOOK_FILE_NAME) : null);
  }

  return Array.from(candidates);
}

function resolveWorkbookFilePath(): string {
  const candidates = getWorkbookPathCandidates();

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) {
        continue;
      }

      fs.accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new InvoiceRefundError(
    `تعذر العثور على الملف ${WORKBOOK_FILE_NAME}. المسارات التي تم فحصها: ${candidates.join(' | ')}`,
    500
  );
}

function readWorkbookState(sheetName?: string): WorkbookState {
  const workbookFilePath = resolveWorkbookFilePath();
  const workbookBuffer = fs.readFileSync(workbookFilePath);
  const workbook = XLSX.read(workbookBuffer, {
    type: 'buffer',
  });
  const resolvedSheetName = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[resolvedSheetName];

  if (!worksheet) {
    throw new InvoiceRefundError(`تعذر العثور على الورقة "${resolvedSheetName}" داخل ${WORKBOOK_FILE_NAME}`, 404);
  }

  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];

  const headerRowIndex = findHeaderRow(rawRows);
  const sourceHeaders = rawRows[headerRowIndex].map(normalizeString);
  const headers = sourceHeaders.includes(ERP_REFUND_INVOICE_ID_HEADER)
    ? sourceHeaders
    : [...sourceHeaders, ERP_REFUND_INVOICE_ID_HEADER];
  const dataRows = rawRows.slice(headerRowIndex + 1);
  const duplicateCounts = new Map<string, number>();
  const baseRows: Array<Omit<WorkbookRow, 'effectiveERPRefundInvoiceId' | 'duplicateCount' | 'hasConflictingERPRefundIds'>> = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const rowNumber = headerRowIndex + index + 2;
    const cells = Object.fromEntries(
      headers.map((header, headerIndex) => [header, normalizeCellValue(row[headerIndex])])
    ) as Record<string, CellValue>;

    const hasAnyValue = Object.values(cells).some((value) => value !== null && value !== '');
    if (!hasAnyValue) {
      continue;
    }

    const customerText = normalizeString(cells[CUSTOMER_HEADER]);
    const orderNumberMatch = customerText.match(ORDER_NUMBER_REGEX);
    const orderNumber = orderNumberMatch?.[1] || null;
    const erpRefundInvoiceId = normalizeString(cells[ERP_REFUND_INVOICE_ID_HEADER]) || null;

    if (orderNumber) {
      duplicateCounts.set(orderNumber, (duplicateCounts.get(orderNumber) || 0) + 1);
    }

    baseRows.push({
      rowKey: `${resolvedSheetName}:${rowNumber}`,
      rowNumber,
      sheetName: resolvedSheetName,
      cells,
      orderNumber,
      erpRefundInvoiceId,
    });
  }

  const rows: WorkbookRow[] = baseRows.map((row) => {
    return {
      ...row,
      effectiveERPRefundInvoiceId: row.erpRefundInvoiceId,
      duplicateCount: row.orderNumber ? duplicateCounts.get(row.orderNumber) || 1 : 1,
      hasConflictingERPRefundIds: false,
    };
  });

  return {
    workbook,
    worksheet,
    filePath: workbookFilePath,
    sheetName: resolvedSheetName,
    headerRowIndex,
    headers,
    hasERPRefundHeader: sourceHeaders.includes(ERP_REFUND_INVOICE_ID_HEADER),
    rows,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchOrderSummaries(orderNumbers: string[]): Promise<Map<string, OrderSummary>> {
  const results = new Map<string, OrderSummary>();
  const uniqueOrderNumbers = Array.from(new Set(orderNumbers.filter(Boolean)));

  for (const batch of chunkArray(uniqueOrderNumbers, 200)) {
    const orders = await prisma.sallaOrder.findMany({
      where: {
        orderNumber: {
          in: batch,
        },
      },
      select: {
        orderId: true,
        orderNumber: true,
        statusSlug: true,
      },
    });

    for (const order of orders) {
      if (!order.orderNumber) {
        continue;
      }

      results.set(order.orderNumber, order);
    }
  }

  return results;
}

function resolveRowStatus(row: WorkbookRow, orderSummary: OrderSummary | null): Omit<InvoiceRefundListRow, 'cells' | 'rowKey' | 'rowNumber' | 'sheetName' | 'orderNumber' | 'duplicateCount' | 'erpRefundInvoiceId' | 'effectiveERPRefundInvoiceId' | 'hasConflictingERPRefundIds'> {
  if (row.erpRefundInvoiceId) {
    return {
      orderFound: Boolean(orderSummary),
      orderStatus: orderSummary?.statusSlug || null,
      status: 'refunded',
      statusLabel: 'تم تسجيل المرتجع',
      statusMessage: 'تم حفظ رقم مرتجع ERP لهذا الصف داخل الملف.',
      canRefund: false,
    };
  }

  if (!row.orderNumber) {
    return {
      orderFound: false,
      orderStatus: null,
      status: 'missing_order_number',
      statusLabel: 'رقم الطلب غير واضح',
      statusMessage: 'تعذر استخراج رقم الطلب من اسم العميل أو الحساب.',
      canRefund: false,
    };
  }

  if (!orderSummary) {
    return {
      orderFound: false,
      orderStatus: null,
      status: 'order_not_found',
      statusLabel: 'الطلب غير موجود',
      statusMessage: 'لم يتم العثور على الطلب داخل جدول SallaOrder.',
      canRefund: false,
    };
  }

  return {
    orderFound: true,
    orderStatus: orderSummary.statusSlug,
    status: 'ready',
    statusLabel: row.duplicateCount > 1 ? 'جاهز مع تكرار داخل الملف' : 'جاهز للاسترداد',
    statusMessage:
      row.duplicateCount > 1
        ? 'هذا الطلب مكرر داخل الملف، وسيتم إنشاء مرتجع ERP مستقل لهذا الصف فقط.'
        : null,
    canRefund: true,
  };
}

function updateSheetRange(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) {
  const currentRange = worksheet['!ref']
    ? XLSX.utils.decode_range(worksheet['!ref'])
    : XLSX.utils.decode_range('A1:A1');

  if (rowIndex > currentRange.e.r) {
    currentRange.e.r = rowIndex;
  }

  if (columnIndex > currentRange.e.c) {
    currentRange.e.c = columnIndex;
  }

  worksheet['!ref'] = XLSX.utils.encode_range(currentRange);
}

function setStringCell(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number, value: string) {
  const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  worksheet[cellAddress] = {
    t: 's',
    v: value,
  };
  updateSheetRange(worksheet, rowIndex, columnIndex);
}

function ensureERPRefundHeaderColumn(state: WorkbookState): number {
  const headerIndex = state.headers.indexOf(ERP_REFUND_INVOICE_ID_HEADER);

  if (headerIndex === -1) {
    state.headers.push(ERP_REFUND_INVOICE_ID_HEADER);
  }

  const resolvedHeaderIndex =
    headerIndex === -1 ? state.headers.length - 1 : headerIndex;

  if (!state.hasERPRefundHeader) {
    setStringCell(
      state.worksheet,
      state.headerRowIndex,
      resolvedHeaderIndex,
      ERP_REFUND_INVOICE_ID_HEADER
    );
    state.hasERPRefundHeader = true;
  }

  return resolvedHeaderIndex;
}

function writeRefundInvoiceIdForRow(state: WorkbookState, rowNumber: number, erpInvoiceId: string): number[] {
  const refundHeaderIndex = ensureERPRefundHeaderColumn(state);
  const row = state.rows.find((item) => item.rowNumber === rowNumber);

  if (!row) {
    throw new InvoiceRefundError(`تعذر العثور على الصف رقم ${rowNumber} داخل الملف`, 404);
  }

  if (row.erpRefundInvoiceId === erpInvoiceId) {
    return [row.rowNumber];
  }

  row.erpRefundInvoiceId = erpInvoiceId;
  row.effectiveERPRefundInvoiceId = erpInvoiceId;
  row.cells[ERP_REFUND_INVOICE_ID_HEADER] = erpInvoiceId;
  setStringCell(state.worksheet, row.rowNumber - 1, refundHeaderIndex, erpInvoiceId);

  const nextWorkbookBuffer = XLSX.write(state.workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;

  fs.writeFileSync(state.filePath, nextWorkbookBuffer);

  return [row.rowNumber];
}

function forceRefundOrder(order: SallaOrder): SallaOrder {
  return {
    ...order,
    statusSlug: 'refund',
  };
}

export async function listInvoiceRefundWorkbookRows(): Promise<InvoiceRefundWorkbookData> {
  const workbookState = readWorkbookState();
  const orderSummaries = await fetchOrderSummaries(
    workbookState.rows.flatMap((row) => (row.orderNumber ? [row.orderNumber] : []))
  );
  const stats = fs.statSync(workbookState.filePath);

  const rows: InvoiceRefundListRow[] = workbookState.rows.map((row) => {
    const orderSummary = row.orderNumber ? orderSummaries.get(row.orderNumber) || null : null;
    const resolvedStatus = resolveRowStatus(row, orderSummary);

    return {
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      sheetName: row.sheetName,
      cells: row.cells,
      orderNumber: row.orderNumber,
      orderFound: resolvedStatus.orderFound,
      orderStatus: resolvedStatus.orderStatus,
      erpRefundInvoiceId: row.erpRefundInvoiceId,
      effectiveERPRefundInvoiceId: row.effectiveERPRefundInvoiceId,
      duplicateCount: row.duplicateCount,
      hasConflictingERPRefundIds: row.hasConflictingERPRefundIds,
      status: resolvedStatus.status,
      statusLabel: resolvedStatus.statusLabel,
      statusMessage: resolvedStatus.statusMessage,
      canRefund: resolvedStatus.canRefund,
    };
  });

  return {
    fileName: WORKBOOK_FILE_NAME,
    filePath: workbookState.filePath,
    sheetName: workbookState.sheetName,
    modifiedAt: stats.mtime.toISOString(),
    headers: workbookState.headers,
    rows,
  };
}

export async function refundInvoiceWorkbookRow(input: {
  rowNumber: number;
  sheetName?: string;
}): Promise<RefundInvoiceWorkbookResult> {
  return queueWorkbookMutation(async () => {
    const workbookState = readWorkbookState(input.sheetName);
    const targetRow = workbookState.rows.find((row) => row.rowNumber === input.rowNumber);

    if (!targetRow) {
      throw new InvoiceRefundError(`تعذر العثور على الصف رقم ${input.rowNumber} داخل الملف`, 404);
    }

    if (!targetRow.orderNumber) {
      throw new InvoiceRefundError('تعذر استخراج رقم الطلب من هذا الصف، ولا يمكن إنشاء مرتجع ERP.', 400);
    }

    const existingERPRefundInvoiceId = targetRow.erpRefundInvoiceId;
    if (existingERPRefundInvoiceId) {
      const updatedRowNumbers = writeRefundInvoiceIdForRow(
        workbookState,
        targetRow.rowNumber,
        existingERPRefundInvoiceId
      );

      return {
        alreadyRecorded: true,
        erpInvoiceId: existingERPRefundInvoiceId,
        updatedRowNumbers,
        message: 'تم العثور على رقم مرتجع ERP محفوظ مسبقاً لهذا الصف.',
      };
    }

    const order = await prisma.sallaOrder.findFirst({
      where: {
        orderNumber: targetRow.orderNumber,
      },
    });

    if (!order) {
      throw new InvoiceRefundError('لم يتم العثور على الطلب داخل قاعدة البيانات.', 404);
    }

    const payload = await transformOrderToERPInvoice(forceRefundOrder(order));
    const result = await postInvoiceToERP(payload);

    if (!result.success) {
      throw new InvoiceRefundError(
        result.error || result.message || 'فشل إنشاء فاتورة المرتجع في ERP',
        502
      );
    }

    const erpInvoiceId = normalizeString(result.erpInvoiceId);
    if (!erpInvoiceId) {
      throw new InvoiceRefundError('نجحت العملية في ERP لكن لم يتم إرجاع رقم فاتورة مرتجع يمكن حفظه في الملف.', 502);
    }

    const updatedRowNumbers = writeRefundInvoiceIdForRow(
      workbookState,
      targetRow.rowNumber,
      erpInvoiceId
    );

    return {
      alreadyRecorded: false,
      erpInvoiceId,
      updatedRowNumbers,
      message: result.message || 'تم إنشاء فاتورة المرتجع وحفظ رقمها داخل الملف.',
    };
  });
}

export { ERP_REFUND_INVOICE_ID_HEADER };
