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
  type LocalShipmentMeta,
} from './serializer';
import {
  detectMessengerShipments,
  extractPrimaryShipTo,
  buildShipToArabicLabel,
  type ShipToDetails,
} from './messenger';
import { getSallaOrderByReference } from '@/app/lib/salla-api';

interface PrintLocalShipmentOptions {
  shipment: LocalShipment;
  printerId?: number;
  copies?: number;
  triggeredBy?: string;
  source?: string;
  userId?: string;
  userName?: string;
  shipToOverride?: ShipToDetails | null;
  messengerCourierLabel?: string | null;
  shipToArabicText?: string | null;
  orderDataOverride?: any;
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

const enrichMessengerMetaIfNeeded = async (
  shipment: LocalShipment,
  meta: LocalShipmentMeta,
  options: {
    providedShipTo?: ShipToDetails | null;
    providedCourierLabel?: string | null;
    providedShipToArabicText?: string | null;
    orderData?: any;
  } = {},
): Promise<LocalShipmentMeta> => {
  const applyShipTo = (
    shipTo?: ShipToDetails | null,
    courierLabel?: string | null,
    shipToArabicTextOverride?: string | null,
    currentMeta: LocalShipmentMeta = meta,
  ): LocalShipmentMeta => {
    if (!shipTo && !courierLabel && !shipToArabicTextOverride) {
      return currentMeta;
    }
    const computedArabicText =
      shipToArabicTextOverride || buildShipToArabicLabel(shipTo) || null;
    return {
      ...currentMeta,
      shipToArabicText: currentMeta.shipToArabicText ?? computedArabicText,
      shipToName: currentMeta.shipToName ?? shipTo?.name ?? null,
      shipToPhone: currentMeta.shipToPhone ?? shipTo?.phone ?? null,
      shipToCity: currentMeta.shipToCity ?? shipTo?.city ?? null,
      shipToDistrict: currentMeta.shipToDistrict ?? shipTo?.district ?? null,
      shipToAddressLine: currentMeta.shipToAddressLine ?? shipTo?.addressLine ?? null,
      shipToPostalCode: currentMeta.shipToPostalCode ?? shipTo?.postalCode ?? null,
      messengerCourierLabel: currentMeta.messengerCourierLabel ?? courierLabel ?? null,
    };
  };

  let nextMeta = applyShipTo(
    options.providedShipTo,
    options.providedCourierLabel,
    options.providedShipToArabicText,
  );

  const needsShipTo =
    !nextMeta.shipToArabicText ||
    !nextMeta.shipToName ||
    !nextMeta.shipToPhone ||
    !nextMeta.shipToCity ||
    !nextMeta.shipToAddressLine;
  const needsCourierLabel = !nextMeta.messengerCourierLabel;

  if (!needsShipTo && !needsCourierLabel) {
    return nextMeta;
  }

  if (!shipment.merchantId || !shipment.orderNumber) {
    return nextMeta;
  }

  try {
    const orderData =
      options.orderData ||
      (await getSallaOrderByReference(shipment.merchantId, shipment.orderNumber));
    if (!orderData) {
      return nextMeta;
    }
    const primaryShipTo = extractPrimaryShipTo(orderData);
    const messengerShipments = detectMessengerShipments(orderData);
    nextMeta = applyShipTo(primaryShipTo, messengerShipments[0]?.courierLabel, null, nextMeta);
    return nextMeta;
  } catch (error) {
    log.warn('Failed to enrich messenger metadata for local shipment', {
      shipmentId: shipment.id,
      error: error instanceof Error ? error.message : error,
    });
    return nextMeta;
  }
};

export async function printLocalShipmentLabel({
  shipment,
  printerId,
  copies = 1,
  triggeredBy,
  source = 'manual',
  userId,
  userName,
  shipToOverride,
  messengerCourierLabel,
  shipToArabicText,
  orderDataOverride,
}: PrintLocalShipmentOptions): Promise<LocalShipmentPrintResult> {
  const labelUrl = getLocalShipmentLabelUrl(shipment.id);
  const normalized = normalizeOrderItems(shipment.orderItems);
  const enrichedMeta = await enrichMessengerMetaIfNeeded(shipment, normalized.meta || {}, {
    providedShipTo: shipToOverride,
    providedCourierLabel: messengerCourierLabel,
    providedShipToArabicText: shipToArabicText,
    orderData: orderDataOverride,
  });
  normalized.meta = enrichedMeta;
  const printableOrderItems = buildOrderItemsPayload(normalized.items, enrichedMeta);
  const printableShipment = {
    ...shipment,
    orderItems: printableOrderItems,
  };

  try {
    const pdfBuffer = await generateLocalShipmentLabelPdf(printableShipment, getMerchantLabelInfo());
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
