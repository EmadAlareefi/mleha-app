/**
 * PrintNode API Integration
 * Documentation: https://www.printnode.com/en/docs/api/curl#printjob-creating
 */

const PRINTNODE_API_KEY = 'qnwXXDzp3JhLS5w1bBWy_F9aIWZgSys1LtMNN4tQcbU';
const PRINTNODE_DEVICE_ID = 75006700;
const PRINTNODE_API_URL = 'https://api.printnode.com/printjobs';
export const PRINTNODE_LABEL_PAPER_NAME = 'LABEL(100mm x 150mm)';
export const PRINTNODE_DEFAULT_DPI = '203x203';
const DEFAULT_LABEL_PAPER_MM = { width: 100, height: 150 } as const;

export interface PrintJobOptions {
  title?: string;
  contentType: 'pdf_uri' | 'pdf_base64' | 'raw_uri' | 'raw_base64';
  content: string;
  copies?: number;
  paperSizeMm?: { width: number; height: number };
  paperName?: string;
  dpi?: number | string;
  fitToPage?: boolean;
  pagesPerSheet?: number;
  rotate?: 0 | 90 | 180 | 270;
  printOptions?: Record<string, unknown>;
}

/**
 * Send a print job to PrintNode
 */
export async function sendPrintJob(options: PrintJobOptions): Promise<{ success: boolean; jobId?: number; error?: string }> {
  try {
    const printOptions = buildPrintOptions(options);

    const printJobData = {
      printerId: PRINTNODE_DEVICE_ID,
      title: options.title || 'Print Job',
      contentType: options.contentType,
      content: options.content,
      qty: options.copies || 1,
      ...(Object.keys(printOptions).length > 0 ? { options: printOptions } : {}),
    };

    const response = await fetch(PRINTNODE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${PRINTNODE_API_KEY}:`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(printJobData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('PrintNode API error:', errorText);
      return {
        success: false,
        error: `PrintNode API error: ${response.status} - ${errorText}`,
      };
    }

    const jobResponse = await response.json();
    const jobId =
      typeof jobResponse === 'number'
        ? jobResponse
        : typeof jobResponse?.id === 'number'
          ? jobResponse.id
          : typeof jobResponse?.jobId === 'number'
            ? jobResponse.jobId
            : undefined;

    console.log('Print job created successfully:', jobResponse);

    return {
      success: true,
      jobId,
    };
  } catch (error) {
    console.error('Failed to send print job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function buildPrintOptions(options: PrintJobOptions): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  if (options.paperName) {
    normalized.paper = options.paperName;
  } else if (options.paperSizeMm) {
    normalized.paper = formatPaperOption(options.paperSizeMm);
  }

  if (typeof options.fitToPage === 'boolean') {
    normalized.fit_to_page = options.fitToPage;
  }

  if (typeof options.pagesPerSheet === 'number') {
    normalized.pages_per_sheet = options.pagesPerSheet;
  }

  if (typeof options.dpi === 'number' || typeof options.dpi === 'string') {
    normalized.dpi = String(options.dpi);
  }

  if (typeof options.rotate === 'number') {
    normalized.rotate = options.rotate;
  }

  if (!options.printOptions) {
    return normalized;
  }

  const { paper, ...rest } = options.printOptions;
  return {
    ...normalized,
    ...rest,
    ...(paper
      ? { paper: typeof paper === 'string' ? paper : formatPaperOption(paper as { width?: number; height?: number }) }
      : {}),
  };
}

function formatPaperOption(paper: { width?: number; height?: number }): string {
  const width = paper?.width ?? DEFAULT_LABEL_PAPER_MM.width;
  const height = paper?.height ?? DEFAULT_LABEL_PAPER_MM.height;
  return `${width}mm x ${height}mm`;
}

/**
 * Generate a simple text-based label for order shipment
 * This creates a plain text label that can be printed
 */
export function generateShipmentLabel(orderData: {
  orderNumber: string;
  customerName: string;
  trackingNumber: string;
  courierName: string;
  location?: string;
  city?: string;
}): string {
  const label = `
========================================
        SHIPMENT LABEL
========================================

Order #: ${orderData.orderNumber}

Customer: ${orderData.customerName}

Shipping Info:
  Courier: ${orderData.courierName}
  Tracking: ${orderData.trackingNumber}

${orderData.location ? `Location: ${orderData.location}` : ''}
${orderData.city ? `City: ${orderData.city}` : ''}

Date: ${new Date().toLocaleString('ar-SA')}

========================================
`;

  return label;
}
