/**
 * PrintNode API Integration
 * Documentation: https://www.printnode.com/en/docs/api/curl#printjob-creating
 */

const PRINTNODE_API_KEY = 'qnwXXDzp3JhLS5w1bBWy_F9aIWZgSys1LtMNN4tQcbU';
const PRINTNODE_DEVICE_ID = 75006700;
const PRINTNODE_API_URL = 'https://api.printnode.com/printjobs';

export interface PrintJobOptions {
  title?: string;
  contentType: 'pdf_uri' | 'pdf_base64' | 'raw_uri' | 'raw_base64';
  content: string;
  copies?: number;
}

/**
 * Send a print job to PrintNode
 */
export async function sendPrintJob(options: PrintJobOptions): Promise<{ success: boolean; jobId?: number; error?: string }> {
  try {
    const printJobData = {
      printerId: PRINTNODE_DEVICE_ID,
      title: options.title || 'Print Job',
      contentType: options.contentType,
      content: options.content,
      qty: options.copies || 1,
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

    const jobId = await response.json();
    console.log('Print job created successfully:', jobId);

    return {
      success: true,
      jobId: jobId,
    };
  } catch (error) {
    console.error('Failed to send print job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
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
