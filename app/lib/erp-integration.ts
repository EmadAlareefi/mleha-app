/**
 * ERP Integration Service
 *
 * This module handles syncing Salla invoices to your ERP system.
 * Configure your ERP API details in environment variables:
 * - ERP_API_URL: Base URL of your ERP API
 * - ERP_API_KEY: Authentication key for ERP API
 * - ERP_API_USERNAME: Username for ERP (if using basic auth)
 * - ERP_API_PASSWORD: Password for ERP (if using basic auth)
 */

import { SallaInvoice } from '@prisma/client';
import { log as logger } from './logger';

export interface ERPInvoicePayload {
  // Customize this interface based on your ERP system's requirements
  invoiceNumber: string;
  orderNumber?: string;
  issueDate: string;
  dueDate?: string;

  // Customer details
  customer: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
  };

  // Financial details
  amounts: {
    subtotal: number;
    tax: number;
    shipping: number;
    discount: number;
    total: number;
  };

  currency: string;
  status?: string;
  paymentStatus?: string;
  notes?: string;

  // Metadata
  metadata: {
    sallaInvoiceId: string;
    sallaMerchantId: string;
    sallaOrderId?: string;
  };
}

export interface ERPSyncResult {
  success: boolean;
  erpInvoiceId?: string;
  erpInvoiceNumber?: string;
  error?: string;
  message?: string;
}

/**
 * Transform Salla invoice to ERP payload format
 */
export function transformInvoiceToERPPayload(invoice: SallaInvoice): ERPInvoicePayload {
  return {
    invoiceNumber: invoice.invoiceNumber || invoice.invoiceId,
    orderNumber: invoice.orderNumber || undefined,
    issueDate: invoice.issueDate?.toISOString() || new Date().toISOString(),
    dueDate: invoice.dueDate?.toISOString() || undefined,

    customer: {
      id: invoice.customerId || undefined,
      name: invoice.customerName || undefined,
      email: invoice.customerEmail || undefined,
      phone: invoice.customerMobile || undefined,
    },

    amounts: {
      subtotal: Number(invoice.subtotalAmount) || 0,
      tax: Number(invoice.taxAmount) || 0,
      shipping: Number(invoice.shippingAmount) || 0,
      discount: Number(invoice.discountAmount) || 0,
      total: Number(invoice.totalAmount) || 0,
    },

    currency: invoice.currency || 'SAR',
    status: invoice.status || undefined,
    paymentStatus: invoice.paymentStatus || undefined,
    notes: invoice.notes || undefined,

    metadata: {
      sallaInvoiceId: invoice.invoiceId,
      sallaMerchantId: invoice.merchantId,
      sallaOrderId: invoice.orderId || undefined,
    },
  };
}

/**
 * Sync invoice to ERP system
 *
 * @param invoice - The Salla invoice to sync
 * @returns Result of the sync operation
 */
export async function syncInvoiceToERP(invoice: SallaInvoice): Promise<ERPSyncResult> {
  try {
    const erpApiUrl = process.env.ERP_API_URL;
    const erpApiKey = process.env.ERP_API_KEY;

    // Validate ERP configuration
    if (!erpApiUrl) {
      throw new Error('ERP_API_URL environment variable is not configured');
    }

    // Transform invoice to ERP payload
    const payload = transformInvoiceToERPPayload(invoice);

    logger.info('Syncing invoice to ERP', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      merchantId: invoice.merchantId,
    });

    // Build request headers
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Authentication methods (choose based on your ERP system)
    if (erpApiKey) {
      // API Key authentication
      headers['Authorization'] = `Bearer ${erpApiKey}`;
      // OR headers['X-API-Key'] = erpApiKey;
    } else if (process.env.ERP_API_USERNAME && process.env.ERP_API_PASSWORD) {
      // Basic authentication
      const credentials = Buffer.from(
        `${process.env.ERP_API_USERNAME}:${process.env.ERP_API_PASSWORD}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    // Make API request to ERP system
    // CUSTOMIZE THIS ENDPOINT based on your ERP system
    const endpoint = `${erpApiUrl}/invoices`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ERP API returned ${response.status}: ${errorText}`
      );
    }

    const result = await response.json();

    logger.info('Invoice synced to ERP successfully', {
      invoiceId: invoice.id,
      erpInvoiceId: result.id || result.invoice_id,
    });

    return {
      success: true,
      erpInvoiceId: result.id || result.invoice_id || undefined,
      erpInvoiceNumber: result.invoice_number || result.invoiceNumber || undefined,
      message: 'Invoice synced successfully',
    };
  } catch (error: any) {
    logger.error('Failed to sync invoice to ERP', {
      invoiceId: invoice.id,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
      message: 'Failed to sync invoice to ERP',
    };
  }
}

/**
 * Example alternative: Sync to a local ERP database
 *
 * If your ERP is a local database instead of an API, use this approach:
 */
export async function syncInvoiceToLocalERP(invoice: SallaInvoice): Promise<ERPSyncResult> {
  try {
    // Example: Insert into a local ERP database using Prisma
    // Uncomment and customize based on your ERP database schema

    /*
    const erpInvoice = await prisma.erpInvoice.create({
      data: {
        invoiceNumber: invoice.invoiceNumber || invoice.invoiceId,
        orderNumber: invoice.orderNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        customerPhone: invoice.customerMobile,
        subtotal: invoice.subtotalAmount,
        tax: invoice.taxAmount,
        shipping: invoice.shippingAmount,
        discount: invoice.discountAmount,
        total: invoice.totalAmount,
        currency: invoice.currency,
        status: invoice.status,
        paymentStatus: invoice.paymentStatus,
        notes: invoice.notes,
        // Foreign key reference
        sallaInvoiceId: invoice.id,
      },
    });

    return {
      success: true,
      erpInvoiceId: erpInvoice.id,
      message: 'Invoice synced to local ERP database',
    };
    */

    // Placeholder return - replace with actual implementation
    throw new Error('Local ERP sync not implemented. Please configure ERP_API_URL or implement local database sync.');
  } catch (error: any) {
    logger.error('Failed to sync invoice to local ERP', {
      invoiceId: invoice.id,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
      message: 'Failed to sync invoice to local ERP',
    };
  }
}
