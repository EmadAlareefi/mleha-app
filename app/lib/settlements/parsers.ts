import * as XLSX from 'xlsx';

export type SettlementProvider = 'salla' | 'smsa' | 'tabby' | 'tamara';

export type ParsedSettlementRecord = {
  provider: SettlementProvider;
  orderId?: string;
  orderNumber?: string;
  awbNumber?: string;
  merchantId?: string;
  paymentMethod?: string;
  eventType?: string;
  settlementDate?: Date;
  grossAmount?: number;
  feeAmount?: number;
  taxAmount?: number;
  netAmount?: number;
  currency?: string;
  sourceReference?: string;
  raw: Record<string, any>;
};

export type SettlementParseResult = {
  records: ParsedSettlementRecord[];
  warnings: string[];
};

export type SettlementParseOptions = {
  statementDate?: Date;
};

export function parseSettlementFile(
  provider: SettlementProvider,
  buffer: Buffer,
  options?: SettlementParseOptions
): SettlementParseResult {
  switch (provider) {
    case 'salla':
      return {
        records: parseSallaSettlement(buffer, options),
        warnings: [],
      };
    case 'smsa':
      return parseSmsaSettlement(buffer, options);
    case 'tabby':
      return parseTabbySettlement(buffer, options);
    case 'tamara':
      return parseTamaraSettlement(buffer, options);
    default:
      return { records: [], warnings: [`Unsupported provider: ${provider}`] };
  }
}

function parseSallaSettlement(buffer: Buffer, options?: SettlementParseOptions): ParsedSettlementRecord[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: null,
    raw: true,
  });

  return rows
    .map((row) => {
      const orderId = normalizeString(row['رقم الطلب']);
      if (!orderId) return null;

      const settlementDate = options?.statementDate;

      return {
        provider: 'salla' as const,
        orderId,
        orderNumber: orderId,
        paymentMethod: normalizeString(row['طريقة الدفع']),
        settlementDate,
        grossAmount: toNumber(row['إجمالي الطلب (ر.س)']),
        feeAmount: toNumber(row['الرسوم (ر.س)']),
        taxAmount: toNumber(row['الضريبة'] ?? row['قيمة الضريبة']),
        netAmount:
          toNumber(row['المُستحق بعد الضريبة (ر.س)']) ??
          toNumber(row['المستحق بعد الضريبة (ر.س)']) ??
          toNumber(row['المستحق بعد الضريبة']),
        currency: 'SAR',
        sourceReference: `${sheetName || 'salla'}-${orderId}`,
        raw: row,
      };
    })
    .filter((row): row is ParsedSettlementRecord => !!row);
}

function parseSmsaSettlement(
  buffer: Buffer,
  options?: SettlementParseOptions
): SettlementParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    return { records: [], warnings: ['SMSA sheet missing'] };
  }

  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
  const headerIndex = rows.findIndex((row) => row.includes('AWB Date'));

  if (headerIndex === -1) {
    return { records: [], warnings: ['لم يتم العثور على رأس الجدول في الملف'] };
  }

  const header = rows[headerIndex] as string[];
  const data = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    header,
    range: headerIndex,
    defval: '',
    raw: true,
  });

  const records: ParsedSettlementRecord[] = [];

  data.forEach((row, index) => {
    const awb = normalizeString(row['AWB']);
    if (!awb) return;

    const referenceOrder = normalizeString(row['Reference #']);
    const settlementDate =
      parseExcelDate(row['AWB Date']) || options?.statementDate;

    records.push({
      provider: 'smsa',
      orderId: referenceOrder || undefined,
      orderNumber: referenceOrder || undefined,
      awbNumber: awb,
      paymentMethod: 'smsa',
      settlementDate,
      grossAmount: toNumber(row['Total Amount Before VAT']),
      feeAmount: toNumber(row['Total Transportation Charges']),
      taxAmount: toNumber(row['Vat Amount']),
      netAmount: toNumber(row['Total Amount']),
      currency: 'SAR',
      sourceReference: `smsa-${awb}-${index}`,
      raw: row,
    });
  });

  return { records, warnings: [] };
}

function parseTabbySettlement(
  buffer: Buffer,
  options?: SettlementParseOptions
): SettlementParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    return { records: [], warnings: ['Tabby sheet missing'] };
  }

  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
  const headerIndex = rows.findIndex((row) =>
    row.includes('Order Number')
  );

  if (headerIndex === -1) {
    return { records: [], warnings: ['تعذر العثور على ترويسة Tabby'] };
  }

  const header = rows[headerIndex] as string[];
  const data = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    header,
    range: headerIndex,
    defval: '',
    raw: true,
  });

  const records: ParsedSettlementRecord[] = data
    .map((row, index) => {
      const orderNumber = normalizeString(row['Order Number']);
      if (!orderNumber) return null;

      const saleDate =
        parseExcelDate(row['Sale/Refund Date']) || options?.statementDate;
      const transferDate = parseExcelDate(row['Transfer Date']);

      return {
        provider: 'tabby' as const,
        orderId: orderNumber,
        orderNumber,
        paymentMethod: normalizeString(row['Product Type'] || row['Type']),
        eventType: normalizeString(row['Type']),
        settlementDate: transferDate || saleDate,
        grossAmount: toNumber(row['Order Amount']),
        feeAmount:
          toNumber(row['Total Deduction']) ?? toNumber(row['Total Fee']),
        taxAmount: toNumber(row['VAT Amount']),
        netAmount: toNumber(row['Transferred amount']),
        currency: normalizeString(row['Currency']) || 'SAR',
        sourceReference: `tabby-${orderNumber}-${row['Type'] || ''}-${index}`,
        raw: row,
      };
    })
    .filter((row): row is ParsedSettlementRecord => !!row);

  return { records, warnings: [] };
}

function parseTamaraSettlement(
  buffer: Buffer,
  options?: SettlementParseOptions
): SettlementParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    return { records: [], warnings: ['Tamara sheet missing'] };
  }

  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
  const headerIndex = rows.findIndex((row) =>
    row.includes('Tamara Order ID')
  );

  if (headerIndex === -1) {
    return { records: [], warnings: ['تعذر العثور على ترويسة Tamara'] };
  }

  const header = rows[headerIndex] as string[];
  const data = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    header,
    range: headerIndex,
    defval: '',
    raw: true,
  });

  const records: ParsedSettlementRecord[] = data
    .map((row, index) => {
      const merchantOrder = normalizeString(row['Merchant Order ID']);
      if (!merchantOrder) return null;

      const transactionDate =
        parseExcelDate(row['Transaction Date DD/MM/YYYY']) ||
        options?.statementDate;
      const eventDate = parseExcelDate(row['Event Date DD/MM/YYYY']);

      return {
        provider: 'tamara' as const,
        orderId: merchantOrder,
        orderNumber: merchantOrder,
        paymentMethod: normalizeString(row['Payment Type']),
        eventType: normalizeString(row['Event']),
        settlementDate: eventDate || transactionDate,
        grossAmount: toNumber(row['Order Amount']),
        feeAmount: toNumber(row['Total Fees']),
        taxAmount: toNumber(row['VAT Collected by Tamara']),
        netAmount: toNumber(row['Total Payable to Merchant']),
        currency: normalizeString(row['Currency']) || 'SAR',
        sourceReference: `tamara-${merchantOrder}-${row['Event'] || ''}-${index}`,
        raw: row,
      };
    })
    .filter((row): row is ParsedSettlementRecord => !!row);

  return { records, warnings: [] };
}

function normalizeString(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  return str.length ? str : undefined;
}

function toNumber(value: any): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (typeof value === 'number' && !Number.isNaN(value)) {
    return Number(value);
  }

  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseExcelDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number' && value > 59) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(
        parsed.y,
        (parsed.m || 1) - 1,
        parsed.d || 1,
        parsed.H || 0,
        parsed.M || 0,
        parsed.S || 0
      );
    }
  }

  // Try parsing strings like DD/MM/YYYY
  const normalized = String(value).trim();
  const [day, month, year] = normalized.split(/[\\/-]/).map((part) => parseInt(part, 10));
  if (year && month) {
    return new Date(year, (month || 1) - 1, day || 1);
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
