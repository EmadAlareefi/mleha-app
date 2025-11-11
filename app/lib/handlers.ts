import { normalizeKSA } from "@/app/lib/phone";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/app/lib/zoko";
import { env } from "@/app/lib/env";
import { log } from "@/app/lib/logger";
import { storeSallaTokens } from "@/app/lib/salla-oauth";

type AnyObj = Record<string, any>;

const TPL = {
  ORDER_CREATED: process.env.ZOKO_TPL_ORDER_CREATED || "order_created",
  ORDER_STATUS: process.env.ZOKO_TPL_ORDER_STATUS || "order_status_update",
  PRODUCTS_UPDATED:
    process.env.ZOKO_TPL_PRODUCTS_UPDATED || "order_products_updated",
  CUSTOMER_LOGIN: process.env.ZOKO_TPL_CUSTOMER_LOGIN || "customer_login",
  SHIPMENT_CREATED:
    process.env.ZOKO_TPL_SHIPMENT_CREATED || "order_shipment_created",
  ABANDONED_CART:
    process.env.ZOKO_TPL_ABANDONED_CART || "abandoned_cart_reminder",
  ABANDONED_CART_PURCHASED:
    process.env.ZOKO_TPL_ABANDONED_CART_PURCHASED ||
    "abandoned_cart_purchased",
  ABANDONED_CART_STATUS_CHANGED:
    process.env.ZOKO_TPL_ABANDONED_CART_STATUS_CHANGED ||
    "abandoned_cart_status_changed",
  ABANDONED_CART_UPDATE:
    process.env.ZOKO_TPL_ABANDONED_CART_UPDATE || "abandoned_cart_update",
};

// Common safe sender
async function sendTpl(
  to: string,
  templateId: string | undefined,
  args: (string | number)[],
  lang: string = env.WHATSAPP_DEFAULT_LANG || "ar"
) {
  if (!templateId) {
    // Fallback to a simple text if no template configured
    const fallback = `إشعار: ${args.map(String).join(" - ")}`;
    return sendWhatsAppText(to, fallback);
  }
  return sendWhatsAppTemplate({
    to,
    templateId,
    lang,
    args,
  });
}

export async function processSallaWebhook(payload: AnyObj) {
  const event = payload?.event || payload?.topic || payload?.type;
  const data = payload?.data ?? payload?.order ?? payload;

  switch (event) {
    case "app.store.authorize":
      return process_app_store_authorize(payload);
    case "order.created":
      return process_salla_order_created(data);
    case "order.updated":
      return process_salla_order_updated(data);
    case "order.status.updated":
      return process_salla_order_status_updated(data);
    case "order.products.updated":
      return update_refunded_quantity(data);
    case "customer.login":
      return process_customer_login(data);
    case "order.shipment.created":
      return process_salla_shipment_created(data);
    case "abandoned.cart":
      return process_abandoned_cart(data);
    case "abandoned.cart.purchased":
      return process_abandoned_cart_purchased(data);
    case "abandoned.cart.status.changed":
      return process_abandoned_cart_status_changed(data);
    case "abandoned.cart.update":
      return process_abandoned_cart_update(data);
    default:
      return { success: true, ignored: event };
  }
}

// ---- Specific handlers (each with its own template) ----

/**
 * Handles Salla app authorization webhook
 * Stores OAuth tokens for future API requests
 */
export async function process_app_store_authorize(payload: AnyObj) {
  const merchantId = String(payload?.merchant ?? "");
  const data = payload?.data ?? {};
  const accessToken = data?.access_token ?? "";
  const refreshToken = data?.refresh_token ?? "";
  const expiresIn = Number(data?.expires ?? 0);
  const scope = data?.scope ?? "";

  if (!merchantId || !accessToken || !refreshToken || !expiresIn) {
    log.error("Invalid app.store.authorize payload", { payload });
    return { success: false, error: "missing_required_fields" };
  }

  try {
    await storeSallaTokens(merchantId, accessToken, refreshToken, expiresIn, scope);
    log.info("Salla app authorized successfully", { merchantId });
    return { success: true, message: "tokens_stored", merchantId };
  } catch (error) {
    log.error("Failed to store Salla tokens", { merchantId, error });
    return { success: false, error: "failed_to_store_tokens" };
  }
}

export async function process_salla_order_updated(data: AnyObj) {

}


export async function process_salla_order_status_updated(data: AnyObj) {
  const order: AnyObj = data?.order ?? data ?? {};
  const orderId = String(order?.id ?? order?.order_id ?? "");
  const status = String(order?.status ?? order?.order_status ?? "").toLowerCase();
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");

  const statusHuman: Record<string, string> = {
    pending: "قيد المراجعة",
    processing: "قيد التجهيز",
    shipped: "تم الشحن",
    delivered: "تم التسليم",
    cancelled: "ملغي",
    refunded: "مرتجع/مسترد",
  };
  const human = statusHuman[status] ?? (status || "غير معروف");

  if (!phone) {
    log.warn("No phone for order status update", { orderId });
    return { success: true, skipped: "no_phone" };
  }

  // Template args e.g. {{1}}=orderId, {{2}}=human status
  const resp = await sendTpl(phone, TPL.ORDER_STATUS, [orderId, human]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_salla_order_created(data: AnyObj) {
  const order: AnyObj = data?.order ?? data ?? {};
  const orderId = String(order?.id ?? order?.order_id ?? "");
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  if (!phone) return { success: true, skipped: "no_phone" };

  // Example args: {{1}}=orderId
  const resp = await sendTpl(phone, TPL.ORDER_CREATED, [orderId]);
  return { success: true, message: "sent", zoko: resp };
}

export async function update_refunded_quantity(data: AnyObj) {
  const order: AnyObj = data?.order ?? data ?? {};
  const orderId = String(order?.id ?? order?.order_id ?? "");
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  if (!phone) return { success: true, skipped: "no_phone" };

  // Minimal args (customize to your template's placeholders)
  const resp = await sendTpl(phone, TPL.PRODUCTS_UPDATED, [orderId]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_customer_login(data: AnyObj) {
  const customer = data?.customer ?? data ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const firstName =
    customer?.first_name || customer?.firstName || customer?.name || "";
  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=firstName
  const resp = await sendTpl(phone, TPL.CUSTOMER_LOGIN, [firstName || "عميلنا"]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_salla_shipment_created(data: AnyObj) {
  const order: AnyObj = data?.order ?? data ?? {};
  const orderId = String(order?.id ?? order?.order_id ?? "");
  const shipment = order?.shipment || data?.shipment || {};
  const tracking = shipment?.tracking_number || shipment?.tracking || "";
  const carrier = shipment?.company || shipment?.carrier || "";

  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=orderId, {{2}}=carrier, {{3}}=tracking
  const resp = await sendTpl(phone, TPL.SHIPMENT_CREATED, [orderId, carrier, tracking]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_abandoned_cart(data: AnyObj) {
  const cart = data?.cart ?? data ?? {};
  const customer = cart?.customer ?? data?.customer ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const firstName =
    customer?.first_name || customer?.firstName || customer?.name || "";
  const link = cart?.url || cart?.link || data?.link || "";

  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=firstName, {{2}}=link
  const resp = await sendTpl(phone, TPL.ABANDONED_CART, [firstName || "ضيفنا", link || ""]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_abandoned_cart_purchased(data: AnyObj) {
  const cart = data?.cart ?? data ?? {};
  const customer = cart?.customer ?? data?.customer ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const firstName =
    customer?.first_name || customer?.firstName || customer?.name || "";

  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=firstName
  const resp = await sendTpl(phone, TPL.ABANDONED_CART_PURCHASED, [firstName || "عميلنا"]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_abandoned_cart_status_changed(data: AnyObj) {
  const cart = data?.cart ?? data ?? {};
  const customer = cart?.customer ?? data?.customer ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const status = String(cart?.status || data?.status || "");
  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=status
  const resp = await sendTpl(phone, TPL.ABANDONED_CART_STATUS_CHANGED, [status || ""]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_abandoned_cart_update(data: AnyObj) {
  const cart = data?.cart ?? data ?? {};
  const customer = cart?.customer ?? data?.customer ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const itemsCount =
    (Array.isArray(cart?.items) && cart.items.length) || data?.items_count || 0;

  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=itemsCount
  const resp = await sendTpl(phone, TPL.ABANDONED_CART_UPDATE, [String(itemsCount)]);
  return { success: true, message: "sent", zoko: resp };
}
