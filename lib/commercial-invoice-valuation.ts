const COMMERCIAL_INVOICE_DEDUCTION_RATE = 0.7;
export const COMMERCIAL_INVOICE_DECLARED_VALUE_MULTIPLIER = 1 - COMMERCIAL_INVOICE_DEDUCTION_RATE;

/**
 * Applies the commercial invoice declared value rules which require deducting 70%
 * of the order's monetary values when printing international invoices.
 */
export const applyCommercialInvoiceDeclaredValue = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value * COMMERCIAL_INVOICE_DECLARED_VALUE_MULTIPLIER;
};
