/**
 * Link to an order in Salla's (new) merchant dashboard.
 * Takes the Salla order id (e.g. 1816631577), not the customer-facing order number.
 * Salla's own `urls.admin` field still points at the old dashboard
 * (/orders/order/<hash>), so don't use that for staff links.
 */
export const sallaOrderUrl = (orderId: string | number) =>
  `https://s.salla.sa/orders/${encodeURIComponent(String(orderId))}`;
