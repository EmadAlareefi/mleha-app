import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import {
  PRINTNODE_DEFAULT_DPI,
  PRINTNODE_LABEL_PAPER_NAME,
  PRINTNODE_LABEL_PRINTER_ID,
  getLabelPrinterSizing,
  sendPrintJob,
} from '@/app/lib/printnode';

/**
 * Shipping-label printing, same printer choice as the old page
 * (app/api/salla/shipments/print/route.ts): the user's linked printer, then a
 * per-username override, then the shared label printer.
 */

const SHIPPING_PRINTER_OVERRIDES: Record<string, number> = {
  '1': 75062490,
  '15': 75062490,
};

export type LabelPrinter = { printerId: number; paperName: string | null };

export async function resolveLabelPrinter(user: { id: string | null; username?: string | null }): Promise<LabelPrinter> {
  let link: { printerId: number; paperName: string | null } | null = null;
  if (user.id) {
    link = await prisma.orderUserPrinterLink
      .findUnique({ where: { userId: user.id }, select: { printerId: true, paperName: true } })
      .catch(() => null);
  }
  const override = user.username ? SHIPPING_PRINTER_OVERRIDES[user.username] : undefined;
  return {
    printerId: link?.printerId ?? override ?? PRINTNODE_LABEL_PRINTER_ID,
    paperName: link?.paperName ?? null,
  };
}

export async function printLabelUrl(input: {
  labelUrl: string;
  orderNumber: string;
  printer: LabelPrinter;
}): Promise<{ success: boolean; jobId?: number; error?: string }> {
  const sizing = getLabelPrinterSizing(input.printer.printerId);
  const paperName = sizing.paperSizeMm ? undefined : sizing.paperName || input.printer.paperName || PRINTNODE_LABEL_PAPER_NAME;
  const result = await sendPrintJob({
    title: `Shipment Label - Order ${input.orderNumber}`,
    contentType: 'pdf_uri',
    content: input.labelUrl,
    copies: 1,
    ...(paperName ? { paperName } : {}),
    ...(sizing.paperSizeMm ? { paperSizeMm: sizing.paperSizeMm } : {}),
    ...(sizing.printOptions ? { printOptions: sizing.printOptions } : {}),
    printerId: input.printer.printerId,
    fitToPage: sizing.fitToPage ?? false,
    dpi: PRINTNODE_DEFAULT_DPI,
    rotate: 0,
  });
  if (!result.success) {
    log.error('Shipping v2 label print failed', { orderNumber: input.orderNumber, error: result.error });
  }
  return result;
}
