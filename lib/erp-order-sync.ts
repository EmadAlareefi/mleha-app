export const NEGATIVE_ERP_INVOICE_ID_PREFIX = '-';

type ERPInvoiceCarrier = {
  id?: unknown;
  invoice_id?: unknown;
  invoiceId?: unknown;
};

type ERPSyncState = {
  erpSyncedAt?: string | Date | null;
  erpInvoiceId?: unknown;
  erpSyncError?: string | null;
};

export function normalizeERPInvoiceId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function extractERPInvoiceId(payload?: ERPInvoiceCarrier | null): string | null {
  if (!payload) {
    return null;
  }

  const candidates = [payload.id, payload.invoice_id, payload.invoiceId];

  for (const candidate of candidates) {
    const normalized = normalizeERPInvoiceId(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function extractERPInvoiceIdFromText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return /^-?\d+$/.test(normalized) ? normalized : null;
}

export function isNegativeERPInvoiceId(value: unknown): boolean {
  const normalized = normalizeERPInvoiceId(value);
  if (!normalized) {
    return false;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed < 0;
}

export function buildNegativeERPInvoiceIdError(value: unknown): string {
  const invoiceId = normalizeERPInvoiceId(value);
  return invoiceId
    ? `ERP returned a negative invoice ID (${invoiceId})`
    : 'ERP returned an invalid invoice ID';
}

export function hasSuccessfulERPSync(state: ERPSyncState): boolean {
  return Boolean(state.erpSyncedAt) && !isNegativeERPInvoiceId(state.erpInvoiceId);
}

export function getERPOrderSyncError(state: ERPSyncState): string | null {
  const syncError = state.erpSyncError?.trim();
  if (syncError) {
    return syncError;
  }

  if (isNegativeERPInvoiceId(state.erpInvoiceId)) {
    return buildNegativeERPInvoiceIdError(state.erpInvoiceId);
  }

  return null;
}
