import { normalizeKSA } from "@/app/lib/phone";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/app/lib/zoko";
import { env } from "@/app/lib/env";
import { log } from "@/app/lib/logger";
import { storeSallaTokens } from "@/app/lib/salla-oauth";

type AnyObj = Record<string, any>;

interface WebhookMeta {
  orderId?: string | null;
  status?: string | null;
  isDuplicateStatus?: boolean;
}

type TemplateName = keyof typeof TPL;

interface TemplateContext {
  customerName: string;
  orderNumber: string;
  reviewLink: string;
  shipment: {
    carrier: string;
    trackingNumber: string;
    trackingLink: string;
  };
}

interface StatusTemplateConfig {
  templateKey?: TemplateName;
  buildArgs?: (ctx: TemplateContext) => (string | number)[];
}

function normalizeStatusValue(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    return value.toString().toLowerCase();
  }
  if (typeof value === "object") {
    const candidate =
      value.slug ?? value.code ?? value.status ?? value.name ?? value.id ?? null;
    return candidate ? String(candidate).toLowerCase() : null;
  }
  return null;
}

function extractOrderStatus(order: AnyObj): string | null {
  if (!order) return null;
  const candidates = [
    order.status,
    order.order_status,
    order.state,
    order.orderStatus,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeStatusValue(candidate);
    if (normalized) return normalized;
  }
  return null;
}

const TEST_WHATSAPP_RECIPIENT =
  process.env.ZOKO_TEST_PHONE || "+966501466365";

const TPL = {
  ORDER_CONFIRMATION:
    process.env.ZOKO_TPL_ORDER_CONFIRMATION || "order_confirmation_ar",
  ORDER_PROCESSING:
    process.env.ZOKO_TPL_ORDER_PROCESSING || "order_processing_ar",
  ORDER_SHIPPED:
    process.env.ZOKO_TPL_ORDER_SHIPPED || "order_shipped_ar",
  ORDER_DELIVERED:
    process.env.ZOKO_TPL_ORDER_DELIVERED || "order_delivered_ar",
  PRODUCTS_UPDATED:
    process.env.ZOKO_TPL_PRODUCTS_UPDATED || "order_products_updated",
  CUSTOMER_LOGIN: process.env.ZOKO_TPL_CUSTOMER_LOGIN || "customer_login",
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

function getCustomerName(customer: AnyObj): string {
  return (
    customer?.first_name ||
    customer?.firstName ||
    customer?.name ||
    customer?.full_name ||
    customer?.customer_name ||
    "عميلنا"
  );
}

function getOrderNumber(order: AnyObj): string {
  return (
    order?.order_number?.toString?.() ||
    order?.orderNumber?.toString?.() ||
    order?.id?.toString?.() ||
    order?.order_id?.toString?.() ||
    ""
  );
}

function getShipmentDetails(order: AnyObj, data?: AnyObj) {
  const shipment = order?.shipment || data?.shipment || {};
  return {
    carrier:
      shipment?.company ||
      shipment?.carrier ||
      order?.shipping_company ||
      "",
    trackingNumber:
      shipment?.tracking_number ||
      shipment?.tracking ||
      order?.tracking_number ||
      "",
    trackingLink:
      shipment?.tracking_link ||
      shipment?.tracking_url ||
      shipment?.tracking_page ||
      shipment?.tracking_web_url ||
      order?.tracking_link ||
      "",
  };
}

function resolveRecipient(to?: string | null) {
  return TEST_WHATSAPP_RECIPIENT || to || "";
}

const STATUS_TEMPLATE_MAP: Record<string, StatusTemplateConfig> = {
  payment_pending: {
    templateKey: "ORDER_CONFIRMATION",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  under_review: {
    templateKey: "ORDER_CONFIRMATION",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  processing: {
    templateKey: "ORDER_PROCESSING",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  in_progress: {
    templateKey: "ORDER_PROCESSING",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  ready_for_pickup: {
    templateKey: "ORDER_PROCESSING",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  shipped: {
    templateKey: "ORDER_SHIPPED",
    buildArgs: (ctx) => [
      ctx.customerName,
      ctx.orderNumber,
      ctx.shipment.carrier,
      ctx.shipment.trackingNumber,
      ctx.shipment.trackingLink,
    ],
  },
  delivering: {
    templateKey: "ORDER_SHIPPED",
    buildArgs: (ctx) => [
      ctx.customerName,
      ctx.orderNumber,
      ctx.shipment.carrier,
      ctx.shipment.trackingNumber,
      ctx.shipment.trackingLink,
    ],
  },
  delivered: {
    templateKey: "ORDER_DELIVERED",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber, ctx.reviewLink],
  },
  completed: {
    templateKey: "ORDER_DELIVERED",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber, ctx.reviewLink],
  },
  canceled: {
    // No template linked yet; configure when ready
  },
  restored: {
    // Shared slug for full/partial restored statuses
  },
  restoring: {
    // No template linked yet
  },
  request_quote: {
    // Quote requests handled manually; no template by default
  },
};

// Common safe sender
async function sendTpl(
  to: string,
  templateId: string | undefined,
  args: (string | number)[],
  lang: string = env.WHATSAPP_DEFAULT_LANG || "ar"
) {
  const recipient = resolveRecipient(to);
  if (!recipient) {
    log.warn("No WhatsApp recipient available for sendTpl");
    return { skipped: "no_recipient" };
  }

  if (!templateId) {
    // Fallback to a simple text if no template configured
    const fallback = `إشعار: ${args.map(String).join(" - ")}`;
    return sendWhatsAppText(recipient, fallback);
  }
  return sendWhatsAppTemplate({
    to: recipient,
    templateId,
    lang,
    args,
  });
}

export async function processSallaWebhook(payload: AnyObj, meta?: WebhookMeta) {
  const event = payload?.event || payload?.topic || payload?.type;
  const data = payload?.data ?? payload?.order ?? payload;

  switch (event) {
    case "app.store.authorize":
      return process_app_store_authorize(payload);
    case "order.created":
      return process_salla_order_created(data);
    case "order.updated":
      return process_salla_order_updated(data, meta);
    case "order.status.updated":
      return process_salla_order_status_updated(data, meta);
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

export async function process_salla_order_updated(data: AnyObj, meta?: WebhookMeta) {
  // Salla sends most status changes via order.updated, so reuse the same flow
  return process_salla_order_status_updated(data, meta);
}


export async function process_salla_order_status_updated(
  data: AnyObj,
  meta?: WebhookMeta
) {
  const order: AnyObj = data?.order ?? data ?? {};
  const orderId = String(order?.id ?? order?.order_id ?? "");
  const status = extractOrderStatus(order);
  if (!status) {
    log.warn("No status found on order payload", { orderId });
    return { success: true, skipped: "no_status" };
  }
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const orderNumber = getOrderNumber(order) || orderId;
  const customerName = getCustomerName(customer);
  const reviewLink =
    process.env.ZOKO_REVIEW_LINK ||
    order?.review_link ||
    order?.survey_link ||
    "";

  const { carrier, trackingNumber, trackingLink } = getShipmentDetails(order, data);

  if (
    meta?.isDuplicateStatus &&
    meta?.orderId === orderId &&
    meta?.status === status
  ) {
    log.info("Skipping duplicate order status notification", { orderId, status });
    return { success: true, skipped: "duplicate_status" };
  }
  const templateCtx: TemplateContext = {
    customerName,
    orderNumber,
    reviewLink,
    shipment: { carrier, trackingNumber, trackingLink },
  };

  const statusConfig = STATUS_TEMPLATE_MAP[status];
  if (!statusConfig || !statusConfig.templateKey) {
    log.info("Status not linked to a template", { orderId, status });
    return { success: true, skipped: "status_not_linked" };
  }

  const templateId = TPL[statusConfig.templateKey];
  const args =
    statusConfig.buildArgs?.(templateCtx) ?? [customerName, orderNumber];

  const resp = await sendTpl(phone || TEST_WHATSAPP_RECIPIENT, templateId, args);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_salla_order_created(data: AnyObj) {
  const order: AnyObj = data?.order ?? data ?? {};
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const customerName = getCustomerName(customer);
  const orderNumber =
    getOrderNumber(order) || String(order?.id ?? order?.order_id ?? "");

  const resp = await sendTpl(
    phone || TEST_WHATSAPP_RECIPIENT,
    TPL.ORDER_CONFIRMATION,
    [customerName, orderNumber]
  );
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
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const customerName = getCustomerName(customer);
  const orderNumber = getOrderNumber(order) || orderId;
  const { carrier, trackingNumber, trackingLink } = getShipmentDetails(order, data);

  const resp = await sendTpl(
    phone || TEST_WHATSAPP_RECIPIENT,
    TPL.ORDER_SHIPPED,
    [customerName, orderNumber, carrier, trackingNumber, trackingLink]
  );
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
