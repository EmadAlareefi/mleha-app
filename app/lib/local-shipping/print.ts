import type { LocalShipment } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  PRINTNODE_DEFAULT_DPI,
  PRINTNODE_LABEL_PAPER_NAME,
  getLabelPrinterSizing,
  sendPrintJob,
} from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';
import { generateLocalShipmentLabelPdf, getMerchantLabelInfo } from './label';
import {
  buildOrderItemsPayload,
  getLocalShipmentLabelUrl,
  normalizeOrderItems,
} from './serializer';

interface PrintLocalShipmentOptions {
  shipment: LocalShipment;
  printerId?: number;
  copies?: number;
  triggeredBy?: string;
  source?: string;
  userId?: string;
  userName?: string;
}

export interface LocalShipmentPrintResult {
  success: boolean;
  jobId?: number;
  error?: string;
  labelUrl: string;
  labelPrintedAt?: string | null;
  printCount?: number;
}

const resolveCollectionAmount = (shipment: LocalShipment, metaValue?: number) => {
  if (typeof metaValue === 'number' && Number.isFinite(metaValue)) {
    return metaValue;
  }
  const fallback = Number(shipment.orderTotal);
  return Number.isFinite(fallback) ? fallback : 0;
};

const resolvePaymentMethod = (shipment: LocalShipment, metaValue?: string | null) => {
  if (typeof metaValue === 'string' && metaValue.trim()) {
    return metaValue;
  }
  return shipment.isCOD ? 'Cash On Delivery' : 'Prepaid';
};

export async function printLocalShipmentLabel({
  shipment,
  printerId,
  copies = 1,
  triggeredBy,
  source = 'manual',
  userId,
  userName,
}: PrintLocalShipmentOptions): Promise<LocalShipmentPrintResult> {
  const labelUrl = getLocalShipmentLabelUrl(shipment.id);
  const normalized = normalizeOrderItems(shipment.orderItems);

  try {
    const pdfBuffer = await generateLocalShipmentLabelPdf(shipment, getMerchantLabelInfo());
    const printerSizing = getLabelPrinterSizing(printerId);

    const printJobResult = await sendPrintJob({
      title: `Local Shipment ${shipment.trackingNumber}`,
      contentType: 'pdf_base64',
      content: pdfBuffer.toString('base64'),
      printerId,
      copies,
      fitToPage: printerSizing.fitToPage ?? true,
      paperName: printerSizing.paperSizeMm ? undefined : printerSizing.paperName || PRINTNODE_LABEL_PAPER_NAME,
      paperSizeMm: printerSizing.paperSizeMm ?? { width: 100, height: 150 },
      printOptions: printerSizing.printOptions,
      dpi: PRINTNODE_DEFAULT_DPI,
    });

    if (!printJobResult.success) {
      log.error('PrintNode error while sending local shipment label', {
        shipmentId: shipment.id,
        orderNumber: shipment.orderNumber,
        error: printJobResult.error,
      });
      return {
        success: false,
        error: printJobResult.error || 'فشل إرسال البوليصة للطابعة',
        labelUrl,
        labelPrintedAt: normalized.meta.labelPrintedAt ?? null,
        printCount: normalized.meta.printCount ?? 0,
      };
    }

    const labelPrintedAt = new Date().toISOString();
    const printCount = (normalized.meta.printCount ?? 0) + 1;
    const updatedMeta = {
      ...normalized.meta,
      collectionAmount: resolveCollectionAmount(shipment, normalized.meta.collectionAmount),
      paymentMethod: resolvePaymentMethod(shipment, normalized.meta.paymentMethod),
      labelPrinted: true,
      labelPrintedAt,
      printCount,
      printJobId: printJobResult.jobId ? String(printJobResult.jobId) : normalized.meta.printJobId,
      labelPrintedBy: userId || triggeredBy || normalized.meta.labelPrintedBy,
      labelPrintedByName: userName || triggeredBy || normalized.meta.labelPrintedByName,
    };

    await prisma.localShipment.update({
      where: { id: shipment.id },
      data: {
        orderItems: buildOrderItemsPayload(normalized.items, updatedMeta),
      },
    });

    log.info('Local shipment label sent to PrintNode', {
      shipmentId: shipment.id,
      orderNumber: shipment.orderNumber,
      jobId: printJobResult.jobId,
      source,
    });

    return {
      success: true,
      jobId: printJobResult.jobId,
      labelUrl,
      labelPrintedAt,
      printCount,
    };
  } catch (error) {
    log.error('Unexpected error while printing local shipment label', {
      shipmentId: shipment.id,
      error: error instanceof Error ? error.message : error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      labelUrl,
      labelPrintedAt: normalized.meta.labelPrintedAt ?? null,
      printCount: normalized.meta.printCount ?? 0,
    };
  }
}
