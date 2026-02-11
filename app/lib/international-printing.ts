import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { detectInternationalOrder, generateCommercialInvoicePdf } from '@/app/lib/commercial-invoice';
import {
  sendPrintJob,
  PRINTNODE_INVOICE_PRINTER_ID,
  PRINTNODE_INVOICE_PAPER_NAME,
} from '@/app/lib/printnode';

const normalizeString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
};

const isSaudiCountry = (value: string): boolean => {
  if (!value) return false;
  const normalized = value.toUpperCase().replace(/\s+/g, '');
  return ['SA', 'SAU', 'SAUDIARABIA', 'السعودية', 'المملكةالعربيةالسعودية'].some(
    (code) => normalized === code.toUpperCase()
  );
};

interface PrintInvoiceParams {
  orderId?: string | null;
  orderNumber?: string | null;
  merchantId?: string | null;
  triggeredBy?: string | null;
  assignmentId?: string | null;
  source?: string;
  forceInternational?: boolean;
  fallbackCountry?: string | null;
  allowDomestic?: boolean;
}

interface PrintInvoiceResult {
  printed: boolean;
  isInternational: boolean;
  country: string;
  message?: string;
  error?: string;
  jobId?: number;
  orderId?: string;
  orderNumber?: string;
}

export async function printCommercialInvoiceIfInternational(params: PrintInvoiceParams): Promise<PrintInvoiceResult> {
  const {
    orderId,
    orderNumber,
    merchantId,
    triggeredBy,
    assignmentId,
    source = 'system',
    forceInternational,
    fallbackCountry,
    allowDomestic,
  } = params;

  if (!orderId && !orderNumber) {
    const message = 'Missing order identifiers';
    log.warn('Skipping invoice print - missing order identifiers', { source, assignmentId });
    return { printed: false, isInternational: false, country: '', error: message };
  }

  try {
    const findOrderByCompositeKey = async () => {
      if (!merchantId || !orderId) return null;
      try {
        return await prisma.sallaOrder.findUnique({
          where: {
            merchantId_orderId: {
              merchantId,
              orderId,
            },
          },
        });
      } catch {
        return null;
      }
    };

    const findOrderByNumber = async () => {
      if (!orderNumber) return null;
      return prisma.sallaOrder.findFirst({
        where: {
          ...(merchantId ? { merchantId } : {}),
          OR: [{ orderNumber }, { referenceId: orderNumber }],
        },
        orderBy: { updatedAt: 'desc' },
      });
    };

    const findOrderFallback = async () => {
      const where: Record<string, unknown> = {
        ...(merchantId ? { merchantId } : {}),
      };

      const orConditions: Record<string, string>[] = [];
      if (orderId) {
        orConditions.push({ orderId });
      }
      if (orderNumber) {
        orConditions.push({ orderNumber });
        orConditions.push({ referenceId: orderNumber });
      }
      if (!orConditions.length) {
        return null;
      }

      (where as any).OR = orConditions;

      return prisma.sallaOrder.findFirst({
        where,
        orderBy: {
          updatedAt: 'desc',
        },
      });
    };

    const orderRecord =
      (await findOrderByCompositeKey()) ||
      (await findOrderByNumber()) ||
      (await findOrderFallback());

    if (!orderRecord?.rawOrder) {
      const errorMessage = 'لم يتم العثور على بيانات الطلب لطباعة الفاتورة';
      log.warn('Unable to load order data for invoice printing', {
        orderId,
        orderNumber,
        merchantId,
        source,
      });
      return { printed: false, isInternational: false, country: '', error: errorMessage };
    }

    const orderData = orderRecord.rawOrder as any;
    let { isInternational, country } = detectInternationalOrder(orderData);
    const normalizedFallbackCountry = normalizeString(fallbackCountry);
    const shouldForceInternational =
      Boolean(forceInternational) ||
      Boolean(normalizedFallbackCountry && !isSaudiCountry(normalizedFallbackCountry));
    const shouldAllowDomestic = Boolean(allowDomestic);
    const hasOverride = shouldForceInternational || shouldAllowDomestic;

    if (hasOverride) {
      isInternational = true;
      country = country || normalizedFallbackCountry || (shouldAllowDomestic ? 'Domestic' : 'International');
      if (shouldAllowDomestic) {
        log.info('Domestic override enabled for commercial invoice print', {
          orderId: orderRecord.orderId,
          orderNumber: orderRecord.orderNumber,
          source,
        });
      }
    }

    if (!isInternational) {
      const message = 'الطلب محلي ولا يحتاج إلى فاتورة تجارية';
      log.info('Order is domestic - skipping commercial invoice print', {
        orderId: orderRecord.orderId,
        orderNumber: orderRecord.orderNumber,
        country,
        source,
      });
      return {
        printed: false,
        isInternational: false,
        country,
        message,
        orderId: orderRecord.orderId,
        orderNumber: orderRecord.orderNumber || orderNumber || undefined,
      };
    }

    const pdfBuffer = await generateCommercialInvoicePdf(
      orderData,
      orderRecord.orderNumber || orderNumber || orderRecord.orderId
    );

    const printResult = await sendPrintJob({
      printerId: PRINTNODE_INVOICE_PRINTER_ID,
      title: `Commercial Invoice - Order ${orderRecord.orderNumber || orderRecord.orderId}`,
      contentType: 'pdf_base64',
      content: pdfBuffer.toString('base64'),
      paperName: PRINTNODE_INVOICE_PAPER_NAME,
      fitToPage: true,
    });

    if (!printResult.success) {
      const errorMessage = printResult.error || 'فشل إرسال الفاتورة التجارية إلى PrintNode';
      log.error('Failed to send commercial invoice to printer', {
        orderId: orderRecord.orderId,
        orderNumber: orderRecord.orderNumber,
        country,
        source,
        error: printResult.error,
      });
      return {
        printed: false,
        isInternational: true,
        country,
        error: errorMessage,
        orderId: orderRecord.orderId,
        orderNumber: orderRecord.orderNumber || orderNumber || undefined,
      };
    }

    log.info('Commercial invoice print job sent', {
      orderId: orderRecord.orderId,
      orderNumber: orderRecord.orderNumber,
      country,
      printerId: PRINTNODE_INVOICE_PRINTER_ID,
      jobId: printResult.jobId,
      assignmentId,
      triggeredBy,
      source,
    });

    return {
      printed: true,
      isInternational: true,
      country,
      jobId: printResult.jobId,
      orderId: orderRecord.orderId,
      orderNumber: orderRecord.orderNumber || orderNumber || undefined,
      message: 'تم إرسال الفاتورة التجارية للطابعة',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    log.error('Unexpected error while printing commercial invoice', {
      error,
      orderId,
      orderNumber,
      source,
    });
    return {
      printed: false,
      isInternational: false,
      country: '',
      error: message,
    };
  }
}
